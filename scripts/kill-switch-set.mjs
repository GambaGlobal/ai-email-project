import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shellValue(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function normalizeBool(raw) {
  const value = (raw ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  return null;
}

function resolvePsqlBin() {
  const envBin = process.env.PSQL_BIN;
  if (envBin && envBin.trim().length > 0) {
    return envBin;
  }

  const candidates = ["/opt/homebrew/opt/postgresql@16/bin/psql", "/usr/local/bin/psql"];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "psql";
}

function runPsql(psqlBin, databaseUrl, sql) {
  return new Promise((resolve) => {
    const child = spawn(psqlBin, [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", sql], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on("error", (error) => {
      resolve({ ok: false, stdout, stderr: `${psqlBin}: ${error.message}` });
    });
  });
}

const databaseUrl = process.env.DATABASE_URL;
const tenantId = process.env.TENANT_ID;
const key = process.env.KEY ?? "docs_ingestion";
const isEnabled = normalizeBool(process.env.IS_ENABLED);
const reason = process.env.REASON ?? "";
const confirm = process.env.KILL_SWITCH_CONFIRM === "1";
const dryRun = process.env.DRY_RUN
  ? process.env.DRY_RUN !== "0"
  : !confirm;

if (!databaseUrl) {
  console.error("kill-switch:set: DATABASE_URL is required");
  process.exit(1);
}
if (!tenantId) {
  console.error("kill-switch:set: TENANT_ID is required");
  process.exit(1);
}
if (!UUID_PATTERN.test(tenantId)) {
  console.error(`kill-switch:set: TENANT_ID must be a UUID, got "${tenantId}"`);
  process.exit(1);
}
if (!key.trim()) {
  console.error("kill-switch:set: KEY must not be empty");
  process.exit(1);
}
if (isEnabled === null) {
  console.error('kill-switch:set: IS_ENABLED must be one of 1/0/true/false/yes/no/on/off');
  process.exit(1);
}

const normalizedReason = reason.trim();
const psqlBin = resolvePsqlBin();
const sql = `
INSERT INTO tenant_kill_switches (tenant_id, key, is_enabled, reason, updated_at)
VALUES (${shellValue(tenantId)}::uuid, ${shellValue(key)}, ${isEnabled ? "true" : "false"}, ${
  normalizedReason ? shellValue(normalizedReason) : "NULL"
}, now())
ON CONFLICT (tenant_id, key) DO UPDATE SET
  is_enabled = EXCLUDED.is_enabled,
  reason = EXCLUDED.reason,
  updated_at = now();
`.trim();

const replayCommand = `DATABASE_URL=${shellValue(databaseUrl)} TENANT_ID=${shellValue(
  tenantId
)} KEY=${shellValue(key)} IS_ENABLED=${shellValue(isEnabled ? "1" : "0")} REASON=${shellValue(
  normalizedReason
)} KILL_SWITCH_CONFIRM=1 pnpm -w kill-switch:set`;

console.log(`mode: ${dryRun ? "dry-run" : "apply"}`);
console.log(`tenantId: ${tenantId}`);
console.log(`key: ${key}`);
console.log(`isEnabled: ${isEnabled}`);
console.log(`reason: ${normalizedReason || "(none)"}`);
console.log("sql:");
console.log(sql);

if (dryRun) {
  console.log("DRY RUN - no database changes applied.");
  console.log(`Re-run with confirm: ${replayCommand}`);
  console.log(`PASS: kill-switch:set tenantId=${tenantId} key=${key} enabled=${isEnabled}`);
  process.exit(0);
}

const result = await runPsql(psqlBin, databaseUrl, sql);
if (!result.ok) {
  if (result.stdout.trim()) {
    console.error(result.stdout.trim());
  }
  if (result.stderr.trim()) {
    console.error(result.stderr.trim());
  }
  process.exit(1);
}

if (result.stdout.trim()) {
  console.log(result.stdout.trim());
}
console.log(`PASS: kill-switch:set tenantId=${tenantId} key=${key} enabled=${isEnabled}`);
