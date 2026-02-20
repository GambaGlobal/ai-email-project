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

function parseNumericResult(stdout) {
  const line = stdout
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => /^[0-9]+$/.test(value))
    .at(-1);
  return Number(line ?? "0");
}

function emitError(errorMessage) {
  console.error(
    JSON.stringify({
      event: "mail.receipts.list.error",
      errorMessage
    })
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const allowAllTenants = process.env.ALLOW_ALL_TENANTS === "1";
  const tenantId = normalizeString(process.env.TENANT_ID);
  const provider = normalizeString(process.env.PROVIDER) ?? "gmail";
  const status = normalizeString(process.env.STATUS);
  const correlationId = normalizeString(process.env.CORRELATION_ID);
  const messageId = normalizeString(process.env.MESSAGE_ID);
  const limit = toIntInRange(process.env.LIMIT, 20, 1, 200);
  const sinceMinutes = toIntInRange(process.env.SINCE_MINUTES, 1440, 1, 10_080);

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
  if (limit === null) {
    emitError("LIMIT must be an integer 1..200");
    process.exit(1);
  }
  if (sinceMinutes === null) {
    emitError("SINCE_MINUTES must be an integer 1..10080");
    process.exit(1);
  }

  const psqlBin = resolvePsqlBin();
  const filters = [`provider = ${sqlLiteral(provider)}`, `received_at >= now() - (${sinceMinutes} * interval '1 minute')`];

  if (tenantId) {
    filters.push(`tenant_id = ${sqlLiteral(tenantId)}::uuid`);
  }
  if (status) {
    filters.push(`processing_status = ${sqlLiteral(status)}`);
  }
  if (correlationId) {
    filters.push(`coalesce(payload->>'correlationId', payload->'attributes'->>'correlationId') = ${sqlLiteral(correlationId)}`);
  }
  if (messageId) {
    filters.push(`message_id = ${sqlLiteral(messageId)}`);
  }

  const whereClause = `WHERE ${filters.join(" AND ")}`;

  const countSql = `
SELECT count(*)
FROM mail_notification_receipts
${whereClause};
`;

  const listSql = `
SELECT json_build_object(
  'event', 'mail.receipts.item',
  'receiptId', id,
  'tenantId', tenant_id,
  'provider', provider,
  'messageId', message_id,
  'correlationId', coalesce(payload->>'correlationId', payload->'attributes'->>'correlationId'),
  'processingStatus', processing_status,
  'attempts', processing_attempts,
  'enqueuedAt', enqueued_at,
  'processedAt', processed_at,
  'lastErrorClass', last_error_class,
  'lastErrorAt', last_error_at
)::text
FROM mail_notification_receipts
${whereClause}
ORDER BY received_at DESC, id DESC
LIMIT ${limit};
`;

  const runner = tenantId && !allowAllTenants
    ? (sql) => runTenantSql(psqlBin, databaseUrl, tenantId, sql)
    : (sql) => runSql(psqlBin, databaseUrl, sql);

  const [countResult, listResult] = await Promise.all([runner(countSql), runner(listSql)]);
  if (!countResult.ok || !listResult.ok) {
    const stderr = `${countResult.stderr ?? ""}\n${listResult.stderr ?? ""}`.trim();
    emitError(stderr || "failed to query mail_notification_receipts");
    process.exit(1);
  }

  const matched = parseNumericResult(countResult.stdout);
  const itemLines = parseTabJsonRows(listResult.stdout);

  console.log(
    JSON.stringify({
      event: "mail.receipts.list",
      tenantId: tenantId ?? null,
      allowAllTenants,
      provider,
      status,
      correlationId,
      messageId,
      sinceMinutes,
      limit
    })
  );
  console.log(JSON.stringify({ event: "mail.receipts.count", matched }));

  for (const line of itemLines) {
    console.log(line);
  }

  console.log(
    `OK mail:receipts:list matched=${matched} tenantId=${tenantId ?? "all"} provider=${provider} status=${status ?? "any"}`
  );
}

void main().catch((error) => {
  emitError(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
