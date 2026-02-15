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
      event: "mail.receipts.show.error",
      errorMessage
    })
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const allowAllTenants = process.env.ALLOW_ALL_TENANTS === "1";
  const tenantId = normalizeString(process.env.TENANT_ID);
  const provider = normalizeString(process.env.PROVIDER) ?? "gmail";
  const receiptId = normalizeString(process.env.RECEIPT_ID);
  const messageId = normalizeString(process.env.MESSAGE_ID);

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
  if (!provider) {
    emitError("PROVIDER must not be empty");
    process.exit(1);
  }

  if ((receiptId && messageId) || (!receiptId && !messageId)) {
    emitError("Provide exactly one selector: RECEIPT_ID or MESSAGE_ID");
    process.exit(1);
  }

  const filters = [`provider = ${sqlLiteral(provider)}`];
  if (tenantId) {
    filters.push(`tenant_id = ${sqlLiteral(tenantId)}::uuid`);
  }
  if (receiptId) {
    filters.push(`id = ${sqlLiteral(receiptId)}::uuid`);
  }
  if (messageId) {
    filters.push(`message_id = ${sqlLiteral(messageId)}`);
  }

  const whereClause = `WHERE ${filters.join(" AND ")}`;

  const showSql = `
SELECT json_build_object(
  'event', 'mail.receipts.record',
  'receiptId', id,
  'tenantId', tenant_id,
  'provider', provider,
  'messageId', message_id,
  'correlationId', coalesce(payload->>'correlationId', payload->'attributes'->>'correlationId'),
  'gmailHistoryId', gmail_history_id,
  'payloadHistoryId', payload->>'historyId',
  'payloadEmailAddress', payload->>'emailAddress',
  'enqueuedAt', enqueued_at,
  'enqueuedJobId', enqueued_job_id,
  'processingStatus', processing_status,
  'attempts', processing_attempts,
  'processingStartedAt', processing_started_at,
  'processedAt', processed_at,
  'lastErrorClass', last_error_class,
  'lastErrorAt', last_error_at,
  'lastError', CASE WHEN last_error IS NULL THEN NULL ELSE LEFT(last_error, 500) END,
  'createdAt', received_at,
  'updatedAt', coalesce(processed_at, last_error_at, enqueued_at, received_at)
)::text
FROM mail_notification_receipts
${whereClause}
ORDER BY received_at DESC, id DESC
LIMIT 1;
`;

  const psqlBin = resolvePsqlBin();
  const runner = tenantId && !allowAllTenants
    ? (sql) => runTenantSql(psqlBin, databaseUrl, tenantId, sql)
    : (sql) => runSql(psqlBin, databaseUrl, sql);

  const showResult = await runner(showSql);
  if (!showResult.ok) {
    emitError((showResult.stderr || "failed to query mail_notification_receipts").trim());
    process.exit(1);
  }

  const rows = parseTabJsonRows(showResult.stdout);
  if (rows.length === 0) {
    emitError("receipt not found");
    process.exit(1);
  }

  const record = JSON.parse(rows[0]);
  console.log(
    JSON.stringify({
      event: "mail.receipts.show",
      tenantId: tenantId ?? null,
      allowAllTenants,
      provider,
      selector: receiptId ? "receipt_id" : "message_id",
      selectorValue: receiptId ?? messageId
    })
  );
  console.log(JSON.stringify(record));
  console.log(`OK mail:receipts:show receiptId=${record.receiptId} status=${record.processingStatus}`);
}

void main().catch((error) => {
  emitError(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
