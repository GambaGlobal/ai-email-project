import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runTenantSql(psqlBin, databaseUrl, tenantId, sql) {
  const wrapped = `
BEGIN;
SET LOCAL app.tenant_id = ${sqlLiteral(tenantId)};
${sql}
COMMIT;
`.trim();

  return new Promise((resolve) => {
    const child = spawn(psqlBin, [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "-c", wrapped], {
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
const jobId = process.env.JOB_ID ?? null;
const correlationId = process.env.CORRELATION_ID ?? null;

if (!databaseUrl) {
  console.error(JSON.stringify({ event: "failures.show.error", message: "DATABASE_URL is required" }));
  console.error("failures:show: DATABASE_URL is required");
  process.exit(1);
}
if (!tenantId) {
  console.error(JSON.stringify({ event: "failures.show.error", message: "TENANT_ID is required" }));
  console.error("failures:show: TENANT_ID is required");
  process.exit(1);
}
if (!UUID_PATTERN.test(tenantId)) {
  console.error(JSON.stringify({ event: "failures.show.error", message: "TENANT_ID must be a UUID" }));
  console.error("failures:show: TENANT_ID must be a UUID");
  process.exit(1);
}
if ((!jobId && !correlationId) || (jobId && correlationId)) {
  console.error(
    JSON.stringify({
      event: "failures.show.error",
      message: "Provide exactly one of JOB_ID or CORRELATION_ID"
    })
  );
  console.error("failures:show: provide exactly one of JOB_ID or CORRELATION_ID");
  process.exit(1);
}

const psqlBin = resolvePsqlBin();
console.log(
  JSON.stringify({
    event: "failures.show",
    tenantId,
    jobId,
    correlationId,
    ts: new Date().toISOString()
  })
);

const whereClause = jobId
  ? `job_id = ${sqlLiteral(jobId)}`
  : `correlation_id = ${sqlLiteral(correlationId)}`;

const showSql = `
SELECT json_build_object(
  'event', 'failures.show.item',
  'id', id,
  'tenantId', tenant_id,
  'correlationId', correlation_id,
  'jobId', job_id,
  'stage', stage,
  'errorClass', error_class,
  'errorCode', error_code,
  'errorMessage', error_message,
  'errorStack', error_stack,
  'attempt', attempt,
  'maxAttempts', max_attempts,
  'createdAt', created_at
)::text
FROM doc_ingestion_failures
WHERE ${whereClause}
ORDER BY created_at DESC, id DESC
LIMIT 1;
`;

const result = await runTenantSql(psqlBin, databaseUrl, tenantId, showSql);
if (!result.ok) {
  const message = result.stderr.trim() || "query failed";
  console.error(JSON.stringify({ event: "failures.show.error", message }));
  console.error(message);
  process.exit(1);
}

const lines = result.stdout
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && line.startsWith("{"));

if (lines.length === 0) {
  console.log(JSON.stringify({ event: "failures.show.summary", tenantId, found: false }));
  console.log(`OK failures:show tenant=${tenantId} jobId=${jobId ?? "n/a"} found=false`);
  process.exit(0);
}

console.log(JSON.stringify({ event: "failures.show.summary", tenantId, found: true, rowCount: 1 }));
console.log(lines[lines.length - 1]);
console.log(`OK failures:show tenant=${tenantId} jobId=${jobId ?? "n/a"}`);
