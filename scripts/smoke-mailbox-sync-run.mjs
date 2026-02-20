import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const databaseUrl = process.env.DATABASE_URL;
const apiBaseUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const tenantId = process.env.TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10000);
const pollMs = 250;

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

function runSql(psqlBin, sql) {
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

function parseLastLine(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function fail({ correlationId, mailboxId, reason, sql, extra }) {
  console.error(
    `FAIL: smoke:mailbox-sync-run correlationId=${correlationId} mailboxId=${mailboxId ?? "unknown"} reason=${reason}`
  );
  if (extra) {
    console.error(extra);
  }
  if (sql) {
    console.error(`SQL: ${sql}`);
  }
  process.exit(1);
}

if (!databaseUrl) {
  fail({
    correlationId: "unknown",
    mailboxId: null,
    reason: "missing_database_url",
    extra: "DATABASE_URL is required"
  });
}

const psqlBin = resolvePsqlBin();
const correlationId = randomUUID();
const messageId = `smoke-mailbox-run-${randomUUID()}`;
const mailboxAddress = "smoke-sync@example.com";

const ensureMailboxSql = `
INSERT INTO tenants (id, name)
VALUES (${sqlLiteral(tenantId)}::uuid, 'Smoke Tenant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO mailboxes (tenant_id, provider, address, email_address, provider_mailbox_id, status)
VALUES (
  ${sqlLiteral(tenantId)}::uuid,
  'gmail',
  ${sqlLiteral(mailboxAddress)},
  ${sqlLiteral(mailboxAddress)},
  ${sqlLiteral(mailboxAddress)},
  'connected'
)
ON CONFLICT (tenant_id, provider, address) DO NOTHING;

SELECT id::text
FROM mailboxes
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND provider = 'gmail'
  AND address = ${sqlLiteral(mailboxAddress)}
ORDER BY id ASC
LIMIT 1;
`;

const mailboxResult = await runSql(psqlBin, ensureMailboxSql);
if (!mailboxResult.ok) {
  fail({
    correlationId,
    mailboxId: null,
    reason: "mailbox_setup_failed",
    sql: ensureMailboxSql,
    extra: mailboxResult.stderr.trim() || "failed creating/finding mailbox"
  });
}

const mailboxId = parseLastLine(mailboxResult.stdout);
if (!mailboxId) {
  fail({
    correlationId,
    mailboxId: null,
    reason: "mailbox_not_found",
    sql: ensureMailboxSql
  });
}

const endpoint = `${apiBaseUrl}/v1/notifications/gmail`;
const body = {
  message: {
    messageId,
    data: Buffer.from(
      JSON.stringify({
        emailAddress: mailboxAddress,
        historyId: "501"
      }),
      "utf8"
    ).toString("base64")
  },
  subscription: "projects/local/subscriptions/smoke-mailbox-sync-run"
};

const headers = {
  "content-type": "application/json",
  "x-correlation-id": correlationId,
  "x-tenant-id": tenantId,
  "x-mailbox-id": mailboxId
};

const controller = new AbortController();
const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: controller.signal
  });

  if (response.status !== 204) {
    fail({
      correlationId,
      mailboxId,
      reason: `notification_status_${response.status}`
    });
  }
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") {
    fail({
      correlationId,
      mailboxId,
      reason: `notification_timeout_${timeoutMs}ms`
    });
  }
  fail({
    correlationId,
    mailboxId,
    reason: "notification_request_error",
    extra: error instanceof Error ? error.message : String(error)
  });
} finally {
  clearTimeout(timeoutHandle);
}

const runQuerySql = `
SELECT id::text || '\t' || fetched_count::text || '\t' || status
FROM mailbox_sync_runs
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND mailbox_id = ${sqlLiteral(mailboxId)}::uuid
  AND correlation_id = ${sqlLiteral(correlationId)}::uuid
ORDER BY started_at DESC
LIMIT 1;
`;

const deadline = Date.now() + timeoutMs;
while (Date.now() <= deadline) {
  const runResult = await runSql(psqlBin, runQuerySql);
  if (!runResult.ok) {
    fail({
      correlationId,
      mailboxId,
      reason: "run_query_failed",
      sql: runQuerySql,
      extra: runResult.stderr.trim() || "failed querying mailbox_sync_runs"
    });
  }

  const line = parseLastLine(runResult.stdout);
  if (line) {
    const [runId, fetchedCount, status] = line.split("\t");
    if (status === "done") {
      console.log(
        `PASS: smoke:mailbox-sync-run correlationId=${correlationId} mailboxId=${mailboxId} runId=${runId} fetchedCount=${fetchedCount}`
      );
      process.exit(0);
    }
  }

  await sleep(pollMs);
}

fail({
  correlationId,
  mailboxId,
  reason: "timeout_waiting_done_run",
  sql: runQuerySql
});
