import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { EOL } from "node:os";

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

let apiChild;
let workerChild;
let shuttingDown = false;

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

function pipeWithPrefix(prefix, stream, logStream) {
  let pending = "";
  stream.on("data", (chunk) => {
    logStream.write(chunk);
    const text = chunk.toString();
    pending += text;
    const parts = pending.split(/\r?\n/);
    pending = parts.pop() ?? "";
    for (const line of parts) {
      if (line.length > 0) {
        process.stdout.write(`[${prefix}] ${line}${EOL}`);
      }
    }
  });
  stream.on("end", () => {
    if (pending.length > 0) {
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

pipeWithPrefix("api", apiChild.stdout, apiLogStream);
pipeWithPrefix("api", apiChild.stderr, apiLogStream);
pipeWithPrefix("worker", workerChild.stdout, workerLogStream);
pipeWithPrefix("worker", workerChild.stderr, workerLogStream);

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

process.on("SIGINT", () => {
  void shutdown("SIGINT", 0);
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM", 0);
});
