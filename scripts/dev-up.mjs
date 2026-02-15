import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { EOL } from "node:os";
import { dirname } from "node:path";

const defaults = {
  REDIS_URL: "redis://127.0.0.1:6379",
  TENANT_AUTOSEED: "1",
  DATABASE_URL: "postgresql://127.0.0.1:5432/ai_email_dev",
  AI_EMAIL_API_LOG: "/tmp/ai-email-api.log",
  AI_EMAIL_WORKER_LOG: "/tmp/ai-email-worker.log"
};

const stateFilePath = ".tmp/dev-processes.json";
const apiPort = 3001;
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
const apiHealthUrl = `http://127.0.0.1:${apiPort}/healthz`;

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

async function listPortListeners(port) {
  const result = await runCommand("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]);
  if (!result.ok && result.stdout.trim().length === 0) {
    return [];
  }

  const listenersByPid = new Map();
  let currentPid = null;
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("p")) {
      const pid = Number(line.slice(1));
      if (Number.isFinite(pid) && pid > 0) {
        currentPid = pid;
        listenersByPid.set(pid, listenersByPid.get(pid) ?? { pid, command: null });
      } else {
        currentPid = null;
      }
      continue;
    }
    if (line.startsWith("c") && currentPid !== null && listenersByPid.has(currentPid)) {
      listenersByPid.set(currentPid, {
        pid: currentPid,
        command: line.slice(1) || null
      });
    }
  }

  return [...listenersByPid.values()].sort((a, b) => a.pid - b.pid);
}

async function waitForPortToClear(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const listeners = await listPortListeners(port);
    if (listeners.length === 0) {
      return [];
    }
    await wait(250);
  }
  return listPortListeners(port);
}

async function reclaimPortOrFail(port) {
  const initialListeners = await listPortListeners(port);
  if (initialListeners.length === 0) {
    return;
  }

  console.log(
    JSON.stringify({
      event: "dev.up.port.in_use",
      port,
      pids: initialListeners.map((listener) => listener.pid)
    })
  );

  for (const listener of initialListeners) {
    await killPid(listener.pid, "SIGTERM");
  }

  let remainingListeners = await waitForPortToClear(port, 2000);
  if (remainingListeners.length > 0) {
    for (const listener of remainingListeners) {
      await killPid(listener.pid, "SIGKILL");
    }
    remainingListeners = await waitForPortToClear(port, 2000);
  }

  if (remainingListeners.length === 0) {
    return;
  }

  const remainingPids = remainingListeners.map((listener) => listener.pid);
  const listenerSummary = remainingListeners
    .map((listener) => `${listener.pid}:${listener.command ?? "unknown"}`)
    .join(",");
  console.log(`FAIL dev:up port-in-use port=${port} pids=${remainingPids.join(",")}`);
  console.log(`dev:up: listeners=${listenerSummary}`);
  console.log(`dev:up: run -> lsof -nP -iTCP:${port} -sTCP:LISTEN`);
  console.log(`dev:up: run -> kill ${remainingPids.join(" ")}`);
  console.log(`dev:up: run -> kill -9 ${remainingPids.join(" ")}`);
  process.exit(1);
}

async function cleanupStartupStateFile() {
  let state;
  try {
    const raw = await readFile(stateFilePath, "utf8");
    state = JSON.parse(raw);
  } catch {
    return;
  }

  console.log(`dev:up: found existing state file at ${stateFilePath}, attempting cleanup`);

  const trackedApiPid = Number(state?.apiPid);
  const trackedWorkerPid = Number(state?.workerPid);
  const trackedPids = [trackedApiPid, trackedWorkerPid].filter((pid) => Number.isFinite(pid) && pid > 0);
  for (const pid of trackedPids) {
    await ensurePidStopped(pid);
  }

  try {
    await rm(stateFilePath, { force: true });
    console.log(`dev:up: removed stale state file ${stateFilePath}`);
  } catch {
    console.log(`dev:up: unable to remove stale state file ${stateFilePath} (continuing)`);
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

await cleanupStartupStateFile();
await reclaimPortOrFail(apiPort);
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
  `OK dev:up ready apiUrl=http://127.0.0.1:${apiPort} healthz=200 apiLog=${apiLogPath} workerLog=${workerLogPath} keepLogs=${
    keepLogs ? 1 : 0
  }`
);

process.on("SIGINT", () => {
  void shutdown("SIGINT", 0);
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM", 0);
});
