import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://127.0.0.1:5432/ai_email_dev";
const apiBaseUrl = process.env.SMOKE_API_BASE_URL ?? "http://127.0.0.1:3001";
const tenantId = process.env.SMOKE_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
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
    `FAIL: smoke:notify-coalesce correlationId=${input.correlationId} mailboxId=${input.mailboxId ?? "unknown"} reason=${input.reason}`
  );
  if (input.extra) {
    console.error(input.extra);
  }
  console.error(
    `smoke: inspect state: /opt/homebrew/opt/postgresql@16/bin/psql "${databaseUrl}" -c "SELECT tenant_id, mailbox_id, provider, last_history_id, pending_max_history_id, enqueued_job_id, enqueued_at, last_error FROM mailbox_sync_state WHERE tenant_id='${tenantId}'::uuid ORDER BY updated_at DESC LIMIT 5;"`
  );
  process.exit(1);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const psqlBin = resolvePsqlBin();
const mailboxAddress = "smoke+notify-coalesce@example.com";
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

const correlationId = randomUUID();
const messageId1 = `smoke-msg-${randomUUID()}`;
const messageId2 = `smoke-msg-${randomUUID()}`;
const endpoint = `${apiBaseUrl}/v1/notifications/gmail`;

const makeBody = (messageId, historyId) => ({
  message: {
    messageId,
    data: Buffer.from(JSON.stringify({ emailAddress: "smoke@example.com", historyId }), "utf8").toString("base64")
  },
  subscription: "projects/local/subscriptions/smoke-notify-coalesce"
});

const headers = {
  "content-type": "application/json",
  "x-correlation-id": correlationId,
  "x-tenant-id": tenantId,
  "x-mailbox-id": mailboxId
};

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const first = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(makeBody(messageId1, "100")),
    signal: controller.signal
  });
  if (first.status !== 204) {
    fail({
      correlationId,
      mailboxId,
      reason: `first_status_${first.status}`
    });
  }

  const second = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(makeBody(messageId2, "105")),
    signal: controller.signal
  });
  if (second.status !== 204) {
    fail({
      correlationId,
      mailboxId,
      reason: `second_status_${second.status}`
    });
  }
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") {
    fail({ correlationId, mailboxId, reason: `request_timeout_${timeoutMs}ms` });
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

const receiptsResult = await runSql(
  psqlBin,
  `
SELECT count(*)::text
FROM mail_notification_receipts
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND provider = 'gmail'
  AND message_id IN (${sqlLiteral(messageId1)}, ${sqlLiteral(messageId2)});
`
);
if (!receiptsResult.ok) {
  fail({
    correlationId,
    mailboxId,
    reason: "receipt_count_query_failed",
    extra: receiptsResult.stderr.trim() || "failed querying receipts"
  });
}

const receiptCount = Number(parseLastLine(receiptsResult.stdout) ?? "0");
if (receiptCount !== 2) {
  fail({
    correlationId,
    mailboxId,
    reason: `unexpected_receipt_count_${receiptCount}`,
    extra: "expected 2 receipt rows for two unique message IDs"
  });
}

const deadline = Date.now() + timeoutMs;
while (Date.now() <= deadline) {
  const stateResult = await runSql(
    psqlBin,
    `
SELECT
  last_history_id::text || '\t' ||
  pending_max_history_id::text || '\t' ||
  coalesce(enqueued_job_id, '') || '\t' ||
  coalesce(enqueued_at::text, '')
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

  const line = parseLastLine(stateResult.stdout);
  if (!line) {
    await sleep(pollMs);
    continue;
  }

  const [lastHistoryId, pendingMaxHistoryId, enqueuedJobId, enqueuedAt] = line.split("\t");

  if (pendingMaxHistoryId !== "105") {
    fail({
      correlationId,
      mailboxId,
      reason: `unexpected_pending_max_${pendingMaxHistoryId}`
    });
  }

  if (lastHistoryId === "105" && (!enqueuedJobId || enqueuedJobId.length === 0) && (!enqueuedAt || enqueuedAt.length === 0)) {
    console.log(
      `PASS: smoke:notify-coalesce correlationId=${correlationId} mailboxId=${mailboxId} lastHistoryId=${lastHistoryId}`
    );
    process.exit(0);
  }

  await sleep(pollMs);
}

fail({
  correlationId,
  mailboxId,
  reason: `timeout_after_${timeoutMs}ms`,
  extra: "mailbox_sync_state did not converge to last_history_id=105 with cleared enqueue markers"
});
