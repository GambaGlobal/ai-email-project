import { spawn } from "node:child_process";
import { rm, readFile } from "node:fs/promises";

const stateFilePath = ".tmp/dev-processes.json";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("close", () => {
      resolve(stdout);
    });
    child.on("error", () => {
      resolve("");
    });
  });
}

async function killPidGracefully(pid) {
  if (!pid || !Number.isFinite(pid)) {
    return false;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }
  await wait(1200);
  try {
    process.kill(pid, 0);
    process.kill(pid, "SIGKILL");
  } catch {
    // process already exited
  }
  return true;
}

async function freePort3001() {
  const stdout = await runCommand("lsof", ["-ti", "tcp:3001"]);
  const pids = stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  const killed = [];
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
      killed.push(pid);
    } catch {
      // best effort
    }
  }
  if (killed.length > 0) {
    console.log(`dev:down: freed tcp:3001 by killing pid(s): ${killed.join(", ")}`);
  }
}

let state = null;
try {
  const raw = await readFile(stateFilePath, "utf8");
  state = JSON.parse(raw);
} catch {
  // no state file
}

if (state) {
  const killedApi = await killPidGracefully(Number(state.apiPid));
  const killedWorker = await killPidGracefully(Number(state.workerPid));
  console.log(
    `dev:down: state stop apiPid=${state.apiPid ?? "n/a"} (${killedApi ? "signaled" : "not running"})`
  );
  console.log(
    `dev:down: state stop workerPid=${state.workerPid ?? "n/a"} (${killedWorker ? "signaled" : "not running"})`
  );
  await rm(stateFilePath, { force: true });
  console.log(`dev:down: removed state file ${stateFilePath}`);
} else {
  console.log(`dev:down: no state file at ${stateFilePath}`);
}

await freePort3001();
console.log("dev:down: done");
console.log("dev:down: verify port with `lsof -nP -iTCP:3001 -sTCP:LISTEN || true`");
