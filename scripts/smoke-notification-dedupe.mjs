import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://127.0.0.1:5432/ai_email_dev";
const apiBaseUrl = process.env.SMOKE_API_BASE_URL ?? "http://127.0.0.1:3001";
const tenantId = process.env.SMOKE_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10000);

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

function parseCount(stdout) {
  const line = stdout
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => /^[0-9]+$/.test(value))
    .at(-1);
  return Number(line ?? "0");
}

function fail(input) {
  console.error(`FAIL: smoke:notify-dedupe FAIL correlationId=${input.correlationId} messageId=${input.messageId} reason=${input.reason}`);
  if (input.extra) {
    console.error(input.extra);
  }
  console.error(
    `smoke: grep API logs: rg -a "${input.correlationId}" /tmp/ai-email-api.log | rg -e "mail.notification.received|mail.notification.deduped"`
  );
  console.error(
    `smoke: verify ledger: /opt/homebrew/opt/postgresql@16/bin/psql \"${databaseUrl ?? '<DATABASE_URL>'}\" -c \"SELECT count(*) FROM mail_notification_receipts WHERE tenant_id='${tenantId}'::uuid AND provider='gmail' AND message_id='${input.messageId}';\"`
  );
  process.exit(1);
}

const correlationId = randomUUID();
const messageId = `smoke-msg-${randomUUID()}`;
const endpoint = `${apiBaseUrl}/v1/notifications/gmail`;

const payloadJson = JSON.stringify({
  emailAddress: "smoke@example.com",
  historyId: "1"
});

const pushBody = {
  message: {
    messageId,
    data: Buffer.from(payloadJson, "utf8").toString("base64")
  },
  subscription: "projects/local/subscriptions/smoke-notify-dedupe"
};

const requestHeaders = {
  "content-type": "application/json",
  "x-correlation-id": correlationId,
  "x-tenant-id": tenantId
};

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(pushBody),
      signal: controller.signal
    });

    if (!response.ok) {
      fail({
        correlationId,
        messageId,
        reason: `request_status_${response.status}`,
        extra: `smoke: POST ${endpoint} returned status=${response.status}`
      });
    }
  }
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") {
    fail({
      correlationId,
      messageId,
      reason: "request_timeout",
      extra: `smoke: request timed out after ${timeoutMs}ms`
    });
  }

  fail({
    correlationId,
    messageId,
    reason: "request_error",
    extra: error instanceof Error ? error.message : String(error)
  });
} finally {
  clearTimeout(timeout);
}

const psqlBin = resolvePsqlBin();
const countSql = `
SELECT count(*)
FROM mail_notification_receipts
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND provider = 'gmail'
  AND message_id = ${sqlLiteral(messageId)};
`;

const countResult = await runSql(psqlBin, countSql);
if (!countResult.ok) {
  fail({
    correlationId,
    messageId,
    reason: "sql_query_failed",
    extra: countResult.stderr.trim() || "failed to query mail_notification_receipts"
  });
}

const rowCount = parseCount(countResult.stdout);
if (rowCount !== 1) {
  fail({
    correlationId,
    messageId,
    reason: `expected_row_count_1_actual_${rowCount}`
  });
}

console.log(`PASS: smoke:notify-dedupe PASS correlationId=${correlationId} messageId=${messageId}`);
process.exit(0);
