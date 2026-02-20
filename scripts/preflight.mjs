import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const fail = (message) => {
  console.error(`preflight: ${message}`);
  console.error("preflight: Run: pnpm -w install");
  console.error("preflight: Then run: pnpm -w repo:check");
  process.exit(1);
};

const info = (message) => {
  console.log(`preflight: ${message}`);
};

const pnpmVersion = spawnSync("pnpm", ["-v"], { encoding: "utf8" });
if (pnpmVersion.error || pnpmVersion.status !== 0) {
  fail("pnpm is not available on PATH.");
}
info(`pnpm ${pnpmVersion.stdout.trim()}`);

if (!existsSync("pnpm-lock.yaml")) {
  fail("Missing pnpm-lock.yaml in repo root.");
}
info("lockfile found");

if (!existsSync("node_modules")) {
  fail("Missing root node_modules directory.");
}

const nodeModulesEntries = readdirSync("node_modules");
const hasPnpmStore = existsSync(join("node_modules", ".pnpm"));
if (nodeModulesEntries.length === 0 && !hasPnpmStore) {
  fail("Root node_modules is empty.");
}
if (!hasPnpmStore) {
  fail("Missing node_modules/.pnpm. Dependencies do not appear installed.");
}
info("node_modules installation looks ready");

if (!existsSync("package.json")) {
  fail("Missing package.json in repo root.");
}

info("preflight passed");
