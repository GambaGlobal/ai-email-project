import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://127.0.0.1:5432/ai_email_dev";
const apiBaseUrl = process.env.SMOKE_API_BASE_URL ?? "http://127.0.0.1:3001";
const tenantId = process.env.SMOKE_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
const historyId = "9007199254740993";
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

function fail(input) {
  console.error(
    `FAIL: smoke:notify-historyid correlationId=${input.correlationId} mailboxId=${input.mailboxId ?? "unknown"} reason=${input.reason}`
  );
  if (input.extra) {
    console.error(input.extra);
  }
  console.error(
    `smoke: inspect state: /opt/homebrew/opt/postgresql@16/bin/psql "${databaseUrl}" -c "SELECT tenant_id, mailbox_id, provider, last_history_id, pending_max_history_id, enqueued_job_id, enqueued_at, last_error, updated_at FROM mailbox_sync_state WHERE tenant_id='${tenantId}'::uuid ORDER BY updated_at DESC LIMIT 5;"`
  );
  process.exit(1);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const psqlBin = resolvePsqlBin();
const mailboxAddress = "smoke+notify-historyid@example.com";
const mailboxResult = await runSql(
  psqlBin,
  `
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
`
);
if (!mailboxResult.ok) {
  fail({
    correlationId: "unknown",
    reason: "mailbox_query_failed",
    extra: mailboxResult.stderr.trim() || "failed to query mailboxes"
  });
}

const mailboxId = parseLastLine(mailboxResult.stdout);
if (!mailboxId) {
  fail({
    correlationId: "unknown",
    reason: "mailbox_not_found",
    extra: "smoke could not create or find a deterministic gmail mailbox row for the tenant"
  });
}

const resetResult = await runSql(
  psqlBin,
  `
DELETE FROM mailbox_sync_state
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND mailbox_id = ${sqlLiteral(mailboxId)}::uuid
  AND provider = 'gmail';
`
);
if (!resetResult.ok) {
  fail({
    correlationId: "unknown",
    mailboxId,
    reason: "state_reset_failed",
    extra: resetResult.stderr.trim() || "failed to reset mailbox_sync_state"
  });
}

const correlationId = randomUUID();
const messageId = `smoke-msg-${randomUUID()}`;
const endpoint = `${apiBaseUrl}/v1/notifications/gmail`;

const requestBody = {
  message: {
    messageId,
    data: Buffer.from(
      JSON.stringify({
        emailAddress: mailboxAddress,
        historyId
      }),
      "utf8"
    ).toString("base64")
  },
  subscription: "projects/local/subscriptions/smoke-notify-historyid"
};

const headers = {
  "content-type": "application/json",
  "x-correlation-id": correlationId,
  "x-tenant-id": tenantId,
  "x-mailbox-id": mailboxId
};

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal: controller.signal
  });

  if (response.status !== 204) {
    fail({
      correlationId,
      mailboxId,
      reason: `unexpected_status_${response.status}`
    });
  }
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") {
    fail({
      correlationId,
      mailboxId,
      reason: `request_timeout_${timeoutMs}ms`
    });
  }
  fail({
    correlationId,
    mailboxId,
    reason: "request_error",
    extra: error instanceof Error ? error.message : String(error)
  });
} finally {
  clearTimeout(timeout);
}

const deadline = Date.now() + timeoutMs;
while (Date.now() <= deadline) {
  const stateResult = await runSql(
    psqlBin,
    `
SELECT
  last_history_id::text || '\t' ||
  pending_max_history_id::text
FROM mailbox_sync_state
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND mailbox_id = ${sqlLiteral(mailboxId)}::uuid
  AND provider = 'gmail'
LIMIT 1;
`
  );

  if (!stateResult.ok) {
    fail({
      correlationId,
      mailboxId,
      reason: "mailbox_sync_query_failed",
      extra: stateResult.stderr.trim() || "failed querying mailbox_sync_state"
    });
  }

  const row = parseLastLine(stateResult.stdout);
  if (!row) {
    await sleep(pollMs);
    continue;
  }

  const [lastHistoryId, pendingMaxHistoryId] = row.split("\t");

  if (lastHistoryId === "9007199254740992" || pendingMaxHistoryId === "9007199254740992") {
    fail({
      correlationId,
      mailboxId,
      reason: "precision_lost_rounded_to_2pow53"
    });
  }

  if (lastHistoryId === historyId || pendingMaxHistoryId === historyId) {
    console.log(
      `PASS: smoke:notify-historyid correlationId=${correlationId} mailboxId=${mailboxId} historyId=${historyId}`
    );
    process.exit(0);
  }

  await sleep(pollMs);
}

fail({
  correlationId,
  mailboxId,
  reason: `timeout_after_${timeoutMs}ms`,
  extra: `mailbox_sync_state did not persist exact historyId=${historyId}`
});
