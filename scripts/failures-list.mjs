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

function toIntInRange(raw, fallback, min, max) {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return null;
  }
  return value;
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
const sinceMinutes = toIntInRange(process.env.SINCE_MINUTES, 60, 1, 10_080);
const limit = toIntInRange(process.env.LIMIT, 20, 1, 200);
const correlationId = process.env.CORRELATION_ID ?? null;
const jobId = process.env.JOB_ID ?? null;

if (!databaseUrl) {
  console.error(JSON.stringify({ event: "failures.list.error", message: "DATABASE_URL is required" }));
  console.error("failures:list: DATABASE_URL is required");
  process.exit(1);
}
if (!tenantId) {
  console.error(JSON.stringify({ event: "failures.list.error", message: "TENANT_ID is required" }));
  console.error("failures:list: TENANT_ID is required");
  process.exit(1);
}
if (!UUID_PATTERN.test(tenantId)) {
  console.error(JSON.stringify({ event: "failures.list.error", message: "TENANT_ID must be a UUID" }));
  console.error("failures:list: TENANT_ID must be a UUID");
  process.exit(1);
}
if (sinceMinutes === null) {
  console.error(
    JSON.stringify({ event: "failures.list.error", message: "SINCE_MINUTES must be an integer 1..10080" })
  );
  console.error("failures:list: SINCE_MINUTES must be an integer 1..10080");
  process.exit(1);
}
if (limit === null) {
  console.error(JSON.stringify({ event: "failures.list.error", message: "LIMIT must be an integer 1..200" }));
  console.error("failures:list: LIMIT must be an integer 1..200");
  process.exit(1);
}

const psqlBin = resolvePsqlBin();
console.log(
  JSON.stringify({
    event: "failures.list",
    tenantId,
    sinceMinutes,
    limit,
    correlationId,
    jobId,
    ts: new Date().toISOString()
  })
);

const filters = [`created_at >= now() - interval '${sinceMinutes} minutes'`];
if (correlationId) {
  filters.push(`correlation_id = ${sqlLiteral(correlationId)}`);
}
if (jobId) {
  filters.push(`job_id = ${sqlLiteral(jobId)}`);
}
const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

const countSql = `
SELECT count(*)
FROM doc_ingestion_failures
${whereClause};
`;

const listSql = `
SELECT json_build_object(
  'event', 'failures.list.item',
  'id', id,
  'tenantId', tenant_id,
  'correlationId', correlation_id,
  'jobId', job_id,
  'stage', stage,
  'errorClass', error_class,
  'errorCode', error_code,
  'errorMessage', error_message,
  'attempt', attempt,
  'maxAttempts', max_attempts,
  'createdAt', created_at
)::text
FROM doc_ingestion_failures
${whereClause}
ORDER BY created_at DESC, id DESC
LIMIT ${limit};
`;

const [countResult, listResult] = await Promise.all([
  runTenantSql(psqlBin, databaseUrl, tenantId, countSql),
  runTenantSql(psqlBin, databaseUrl, tenantId, listSql)
]);

if (!countResult.ok || !listResult.ok) {
  const stderr = `${countResult.stderr ?? ""}\n${listResult.stderr ?? ""}`.trim();
  console.error(JSON.stringify({ event: "failures.list.error", message: stderr || "query failed" }));
  if (stderr) {
    console.error(stderr);
  }
  process.exit(1);
}

const countLine = countResult.stdout
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => /^[0-9]+$/.test(line))
  .at(-1);
const totalCount = Number(countLine ?? "0");
const itemLines = listResult.stdout
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && line.startsWith("{"));

console.log(
  JSON.stringify({
    event: "failures.list.summary",
    tenantId,
    totalCount,
    returnedCount: itemLines.length,
    sinceMinutes,
    limit
  })
);
for (const line of itemLines) {
  console.log(line);
}
console.log(`OK failures:list tenant=${tenantId} count=${itemLines.length}`);
