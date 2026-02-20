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

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function runSql(psqlBin, databaseUrl, sql) {
  return new Promise((resolve) => {
    const child = spawn(psqlBin, [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "-c", sql], {
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

function runTenantSql(psqlBin, databaseUrl, tenantId, sql) {
  const wrapped = `
BEGIN;
SELECT set_config('app.tenant_id', ${sqlLiteral(tenantId)}, true);
${sql}
COMMIT;
`.trim();

  return runSql(psqlBin, databaseUrl, wrapped);
}

function parseTabJsonRows(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tabIndex = line.indexOf("\t");
      return tabIndex === -1 ? line : line.slice(tabIndex + 1);
    })
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
}

function emitError(errorMessage) {
  console.error(
    JSON.stringify({
      event: "mailbox.sync.show.error",
      errorMessage
    })
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const allowAllTenants = process.env.ALLOW_ALL_TENANTS === "1";
  const tenantId = normalizeString(process.env.TENANT_ID);
  const mailboxId = normalizeString(process.env.MAILBOX_ID);
  const provider = normalizeString(process.env.PROVIDER) ?? "gmail";

  if (!databaseUrl) {
    emitError("DATABASE_URL is required");
    process.exit(1);
  }
  if (!allowAllTenants && !tenantId) {
    emitError("TENANT_ID is required unless ALLOW_ALL_TENANTS=1");
    process.exit(1);
  }
  if (tenantId && !UUID_PATTERN.test(tenantId)) {
    emitError("TENANT_ID must be a UUID");
    process.exit(1);
  }
  if (!mailboxId) {
    emitError("MAILBOX_ID is required");
    process.exit(1);
  }
  if (!UUID_PATTERN.test(mailboxId)) {
    emitError("MAILBOX_ID must be a UUID");
    process.exit(1);
  }

  const filters = [`provider = ${sqlLiteral(provider)}`, `mailbox_id = ${sqlLiteral(mailboxId)}::uuid`];
  if (tenantId) {
    filters.push(`tenant_id = ${sqlLiteral(tenantId)}::uuid`);
  }
  const whereClause = `WHERE ${filters.join(" AND ")}`;

  const showSql = `
SELECT json_build_object(
  'event', 'mailbox.sync.record',
  'tenantId', tenant_id,
  'mailboxId', mailbox_id,
  'provider', provider,
  'lastHistoryId', last_history_id::text,
  'pendingMaxHistoryId', pending_max_history_id::text,
  'lastCorrelationId', last_correlation_id,
  'pendingUpdatedAt', pending_updated_at,
  'lastSyncedAt', last_processed_at,
  'enqueuedAt', enqueued_at,
  'enqueuedJobId', enqueued_job_id,
  'lastErrorAt', CASE WHEN last_error IS NULL THEN NULL ELSE updated_at END,
  'lastErrorClass', CASE
    WHEN last_error IS NULL THEN NULL
    WHEN lower(last_error) LIKE '%missing%' OR lower(last_error) LIKE '%invalid%' THEN 'permanent'
    WHEN lower(last_error) LIKE '%timeout%' OR lower(last_error) LIKE '%econn%' THEN 'transient'
    ELSE 'unknown'
  END,
  'lastError', CASE WHEN last_error IS NULL THEN NULL ELSE LEFT(last_error, 500) END,
  'updatedAt', updated_at
)::text
FROM mailbox_sync_state
${whereClause}
LIMIT 1;
`;

  const psqlBin = resolvePsqlBin();
  const runner = tenantId && !allowAllTenants
    ? (sql) => runTenantSql(psqlBin, databaseUrl, tenantId, sql)
    : (sql) => runSql(psqlBin, databaseUrl, sql);

  const result = await runner(showSql);
  if (!result.ok) {
    emitError((result.stderr || "failed to query mailbox_sync_state").trim());
    process.exit(1);
  }

  const rows = parseTabJsonRows(result.stdout);
  if (rows.length === 0) {
    emitError("mailbox sync row not found");
    process.exit(1);
  }

  const record = JSON.parse(rows[0]);

  console.log(
    JSON.stringify({
      event: "mailbox.sync.show",
      tenantId: tenantId ?? null,
      allowAllTenants,
      provider,
      mailboxId
    })
  );
  console.log(JSON.stringify(record));
  console.log(`OK mailbox:sync:show mailboxId=${mailboxId}`);
}

void main().catch((error) => {
  emitError(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
