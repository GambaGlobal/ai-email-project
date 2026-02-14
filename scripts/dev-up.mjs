import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { EOL } from "node:os";
import { dirname } from "node:path";

const defaults = {
  REDIS_URL: "redis://127.0.0.1:6379",
  DOCS_STORAGE: "local",
  DOCS_LOCAL_DIR: "/tmp/ai-email-docs",
  TENANT_AUTOSEED: "1",
  DATABASE_URL: "postgresql://127.0.0.1:5432/ai_email_dev",
  AI_EMAIL_API_LOG: "/tmp/ai-email-api.log",
  AI_EMAIL_WORKER_LOG: "/tmp/ai-email-worker.log"
};

const stateFilePath = ".tmp/dev-processes.json";
const env = { ...process.env };
for (const [key, value] of Object.entries(defaults)) {
  if (!env[key]) {
    env[key] = value;
  }
}

const apiLogPath = env.AI_EMAIL_API_LOG;
const workerLogPath = env.AI_EMAIL_WORKER_LOG;
const keepLogs = env.KEEP_LOGS === "1";
const apiReadyTimeoutMs = Number.parseInt(env.DEV_UP_TIMEOUT_MS ?? "20000", 10);
const workerReadyTimeoutMs = Number.parseInt(env.WORKER_READY_TIMEOUT_MS ?? "10000", 10);
const apiHealthUrl = "http://127.0.0.1:3001/healthz";

let apiChild;
let workerChild;
let shuttingDown = false;
let apiReadySignal = false;
let workerReadySignal = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0, code: code ?? 1, stdout, stderr });
    });
    child.on("error", () => {
      resolve({ ok: false, code: 1, stdout, stderr });
    });
  });
}

async function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function ensurePidStopped(pid) {
  if (!pid) {
    return;
  }
  await killPid(pid, "SIGTERM");
  await wait(1200);
  try {
    process.kill(pid, 0);
    await killPid(pid, "SIGKILL");
  } catch {
    // already stopped
  }
}

async function freePort3001() {
  const result = await runCommand("lsof", ["-ti", "tcp:3001"]);
  if (!result.ok && result.stdout.trim().length === 0) {
    return;
  }
  const pids = result.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  const killed = [];
  const failed = [];
  for (const pid of pids) {
    if (await killPid(pid, "SIGKILL")) {
      killed.push(pid);
    } else {
      failed.push(pid);
    }
  }
  if (killed.length > 0) {
    console.log(`dev:up: freed tcp:3001 by killing pid(s): ${killed.join(", ")}`);
  }
  if (failed.length > 0) {
    console.log(`dev:up: unable to kill pid(s) on tcp:3001: ${failed.join(", ")}`);
  }
}

function pipeWithPrefix(prefix, stream, logStream, onLine) {
  let pending = "";
  stream.on("data", (chunk) => {
    logStream.write(chunk);
    const text = chunk.toString();
    pending += text;
    const parts = pending.split(/\r?\n/);
    pending = parts.pop() ?? "";
    for (const line of parts) {
      if (line.length > 0) {
        if (onLine) {
          onLine(line);
        }
        process.stdout.write(`[${prefix}] ${line}${EOL}`);
      }
    }
  });
  stream.on("end", () => {
    if (pending.length > 0) {
      if (onLine) {
        onLine(pending);
      }
      process.stdout.write(`[${prefix}] ${pending}${EOL}`);
    }
  });
}

async function shutdown(reason, exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (reason) {
    console.log(`dev:up: shutting down (${reason})`);
  }
  await Promise.all([ensurePidStopped(apiChild?.pid), ensurePidStopped(workerChild?.pid)]);
  process.exit(exitCode);
}

async function fetchHttpStatus(urlValue) {
  const target = new URL(urlValue);
  const client = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      target,
      {
        method: "GET",
        timeout: 2000
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        res.resume();
        resolve(statusCode);
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForApiReady(urlValue, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await fetchHttpStatus(urlValue);
      if (status === 200 && apiReadySignal) {
        return status;
      }
    } catch {
      // continue polling
    }
    await wait(250);
  }
  return null;
}

async function waitForWorkerReady(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (workerReadySignal) {
      return true;
    }
    await wait(250);
  }
  return false;
}

async function printApiLogTail(logPath, lineCount) {
  try {
    const content = await readFile(logPath, "utf8");
    const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
    const tail = lines.slice(-lineCount);
    if (tail.length === 0) {
      console.log(`dev:up: api log is empty (${logPath})`);
      return;
    }
    console.log(`dev:up: last ${tail.length} api log lines (${logPath})`);
    for (const line of tail) {
      console.log(line);
    }
  } catch {
    console.log(`dev:up: api log missing/unreadable (${logPath})`);
  }
}

if (!Number.isInteger(apiReadyTimeoutMs) || apiReadyTimeoutMs < 1000 || apiReadyTimeoutMs > 300000) {
  console.error("dev:up: DEV_UP_TIMEOUT_MS must be an integer 1000..300000");
  process.exit(1);
}

if (
  !Number.isInteger(workerReadyTimeoutMs) ||
  workerReadyTimeoutMs < 1000 ||
  workerReadyTimeoutMs > 300000
) {
  console.error("dev:up: WORKER_READY_TIMEOUT_MS must be an integer 1000..300000");
  process.exit(1);
}

const brewCheck = await runCommand("brew", ["--version"]);
if (brewCheck.ok) {
  const redisStart = await runCommand("brew", ["services", "start", "redis"]);
  if (!redisStart.ok) {
    console.log("dev:up: brew services start redis failed (continuing)");
  }
  const pgStart = await runCommand("brew", ["services", "start", "postgresql@16"]);
  if (!pgStart.ok) {
    console.log("dev:up: brew services start postgresql@16 failed (continuing)");
  }
}

await freePort3001();
await mkdir(".tmp", { recursive: true });
await mkdir(dirname(apiLogPath), { recursive: true });
await mkdir(dirname(workerLogPath), { recursive: true });

if (!keepLogs) {
  await writeFile(apiLogPath, "");
  await writeFile(workerLogPath, "");
}

console.log(
  `dev:up: logs api=${apiLogPath} worker=${workerLogPath} keepLogs=${keepLogs ? 1 : 0} truncated=${
    keepLogs ? 0 : 1
  }`
);

if (env.SKIP_DB_SETUP !== "1") {
  console.log("dev:up: running db bootstrap (pnpm -w db:setup)");
  const dbSetup = await runCommand("pnpm", ["-w", "db:setup"], { stdio: "inherit" });
  if (!dbSetup.ok) {
    console.error("dev:up: db setup failed");
    process.exit(1);
  }
} else {
  console.log("dev:up: SKIP_DB_SETUP=1, skipping db bootstrap");
}

const apiLogStream = createWriteStream(apiLogPath, { flags: "a" });
const workerLogStream = createWriteStream(workerLogPath, { flags: "a" });

apiChild = spawn("pnpm", ["-w", "--filter", "@ai-email/api", "dev"], {
  env,
  stdio: ["ignore", "pipe", "pipe"]
});
workerChild = spawn("pnpm", ["-w", "--filter", "@ai-email/worker", "dev"], {
  env,
  stdio: ["ignore", "pipe", "pipe"]
});

pipeWithPrefix("api", apiChild.stdout, apiLogStream, (line) => {
  if (/api ready on/i.test(line)) {
    apiReadySignal = true;
  }
});
pipeWithPrefix("api", apiChild.stderr, apiLogStream, (line) => {
  if (/api ready on/i.test(line)) {
    apiReadySignal = true;
  }
});
pipeWithPrefix("worker", workerChild.stdout, workerLogStream, (line) => {
  if (/worker ready/i.test(line)) {
    workerReadySignal = true;
  }
});
pipeWithPrefix("worker", workerChild.stderr, workerLogStream, (line) => {
  if (/worker ready/i.test(line)) {
    workerReadySignal = true;
  }
});

await writeFile(
  stateFilePath,
  JSON.stringify(
    {
      apiPid: apiChild.pid,
      workerPid: workerChild.pid,
      apiLog: apiLogPath,
      workerLog: workerLogPath,
      startedAt: new Date().toISOString()
    },
    null,
    2
  )
);

console.log(`dev:up: API log => ${apiLogPath}`);
console.log(`dev:up: worker log => ${workerLogPath}`);
console.log(`dev:up: state => ${stateFilePath}`);

apiChild.on("exit", (code, signal) => {
  if (!shuttingDown) {
    void shutdown(`api exited (code=${code ?? "null"} signal=${signal ?? "null"})`, 1);
  }
});
workerChild.on("exit", (code, signal) => {
  if (!shuttingDown) {
    void shutdown(`worker exited (code=${code ?? "null"} signal=${signal ?? "null"})`, 1);
  }
});

const workerReadyPromise = waitForWorkerReady(workerReadyTimeoutMs);
const apiStatus = await waitForApiReady(apiHealthUrl, apiReadyTimeoutMs);
if (apiStatus !== 200) {
  console.log(`FAIL dev:up api-not-ready timeoutMs=${apiReadyTimeoutMs}`);
  await printApiLogTail(apiLogPath, 50);
  await shutdown("api-not-ready", 1);
}

const workerReady = await workerReadyPromise;
if (!workerReady) {
  console.log(`WARN dev:up worker-not-ready timeoutMs=${workerReadyTimeoutMs} (continuing)`);
}

console.log(
  `OK dev:up ready apiUrl=http://127.0.0.1:3001 healthz=200 apiLog=${apiLogPath} workerLog=${workerLogPath} keepLogs=${
    keepLogs ? 1 : 0
  }`
);

process.on("SIGINT", () => {
  void shutdown("SIGINT", 0);
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM", 0);
});
