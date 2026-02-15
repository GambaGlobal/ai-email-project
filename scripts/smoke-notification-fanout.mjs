import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://127.0.0.1:5432/ai_email_dev";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const apiBaseUrl = process.env.SMOKE_API_BASE_URL ?? "http://127.0.0.1:3001";
const tenantId = process.env.SMOKE_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10000);
const logTimeoutMs = Number(process.env.SMOKE_LOG_TIMEOUT_MS ?? 10000);
const apiLogPath = process.env.AI_EMAIL_API_LOG ?? "/tmp/ai-email-api.log";
const workerLogPath = process.env.AI_EMAIL_WORKER_LOG ?? "/tmp/ai-email-worker.log";

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

function parseTabLastLine(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);
}

async function readLog(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const maybeError = error;
    if (typeof maybeError === "object" && maybeError !== null && "code" in maybeError) {
      if (maybeError.code === "ENOENT") {
        return "";
      }
    }
    throw error;
  }
}

function parseJsonFromLogLine(line) {
  const start = line.indexOf("{");
  const end = line.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }

  const candidate = line.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function collectEvents(logText) {
  const events = [];
  for (const line of logText.split("\n")) {
    const parsed = parseJsonFromLogLine(line);
    if (parsed) {
      events.push(parsed);
    }
  }
  return events;
}

function fail(input) {
  console.error(`FAIL: smoke:notify-fanout correlationId=${input.correlationId} reason=${input.reason}`);
  if (input.missing && input.missing.length > 0) {
    console.error("smoke: missing evidence:");
    for (const item of input.missing) {
      console.error(`- ${item}`);
    }
  }
  if (input.extra) {
    console.error(input.extra);
  }
  console.error(
    `smoke: grep API logs: rg -a "${input.correlationId}" "${apiLogPath}" | rg -e "mail.notification.received|mail.notification.enqueued|mail.notification.deduped"`
  );
  console.error(
    `smoke: grep worker logs: rg -a "${input.correlationId}" "${workerLogPath}" | rg -e "job.start|job.done|job.error"`
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

const requestBody = {
  message: {
    messageId,
    data: Buffer.from(payloadJson, "utf8").toString("base64")
  },
  subscription: "projects/local/subscriptions/smoke-notify-fanout"
};

const headers = {
  "content-type": "application/json",
  "x-correlation-id": correlationId,
  "x-tenant-id": tenantId
};

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (response.status !== 204) {
      fail({
        correlationId,
        reason: `unexpected_status_${response.status}`,
        extra: `smoke: POST ${endpoint} returned status=${response.status}`
      });
    }
  }
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") {
    fail({
      correlationId,
      reason: "request_timeout",
      extra: `smoke: request timed out after ${timeoutMs}ms`
    });
  }

  fail({
    correlationId,
    reason: "request_error",
    extra: error instanceof Error ? error.message : String(error)
  });
} finally {
  clearTimeout(timeout);
}

const psqlBin = resolvePsqlBin();
const receiptSql = `
SELECT count(*)::text || '\t' || count(enqueued_job_id)::text || '\t' || coalesce(max(enqueued_job_id), '')
FROM mail_notification_receipts
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND provider = 'gmail'
  AND message_id = ${sqlLiteral(messageId)};
`;

const receiptResult = await runSql(psqlBin, receiptSql);
if (!receiptResult.ok) {
  fail({
    correlationId,
    reason: "receipt_query_failed",
    extra: receiptResult.stderr.trim() || "failed to query mail_notification_receipts"
  });
}

const summary = parseTabLastLine(receiptResult.stdout);
const [rowCountRaw, enqueuedCountRaw, enqueuedJobIdRaw] = String(summary ?? "").split("\t");
const rowCount = Number(rowCountRaw ?? "0");
const enqueuedCount = Number(enqueuedCountRaw ?? "0");
const enqueuedJobId = enqueuedJobIdRaw && enqueuedJobIdRaw.length > 0 ? enqueuedJobIdRaw : null;

if (rowCount !== 1 || enqueuedCount !== 1 || !enqueuedJobId) {
  fail({
    correlationId,
    reason: `unexpected_receipt_counts rows=${rowCount} enqueued=${enqueuedCount}`,
    extra: `smoke: expected one receipt row and one enqueued_job_id for messageId=${messageId}`
  });
}

const deadline = Date.now() + logTimeoutMs;
while (Date.now() <= deadline) {
  const [apiLog, workerLog] = await Promise.all([readLog(apiLogPath), readLog(workerLogPath)]);
  const apiEvents = collectEvents(apiLog);
  const workerEvents = collectEvents(workerLog);

  const apiReceived = apiEvents.find(
    (event) =>
      event.event === "mail.notification.received" &&
      event.correlationId === correlationId &&
      event.messageId === messageId
  );
  const apiEnqueued = apiEvents.find(
    (event) =>
      event.event === "mail.notification.enqueued" &&
      event.correlationId === correlationId &&
      event.messageId === messageId &&
      event.jobId === enqueuedJobId
  );
  const workerStart = workerEvents.find(
    (event) =>
      event.event === "job.start" &&
      event.correlationId === correlationId &&
      event.jobId === enqueuedJobId &&
      event.queueName === "mail_notifications"
  );
  const workerDone = workerEvents.find(
    (event) =>
      event.event === "job.done" &&
      event.correlationId === correlationId &&
      event.jobId === enqueuedJobId &&
      event.queueName === "mail_notifications"
  );
  const workerError = workerEvents.find(
    (event) =>
      event.event === "job.error" &&
      event.correlationId === correlationId &&
      event.jobId === enqueuedJobId &&
      event.queueName === "mail_notifications"
  );

  if (apiReceived && apiEnqueued && workerStart && (workerDone || workerError)) {
    console.log(`PASS: smoke:notify-fanout correlationId=${correlationId} jobId=${enqueuedJobId}`);
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
}

const [finalApiLog, finalWorkerLog] = await Promise.all([readLog(apiLogPath), readLog(workerLogPath)]);
const finalApiEvents = collectEvents(finalApiLog);
const finalWorkerEvents = collectEvents(finalWorkerLog);

const missing = [];
if (
  !finalApiEvents.some(
    (event) =>
      event.event === "mail.notification.received" &&
      event.correlationId === correlationId &&
      event.messageId === messageId
  )
) {
  missing.push("api.mail.notification.received");
}
if (
  !finalApiEvents.some(
    (event) =>
      event.event === "mail.notification.enqueued" &&
      event.correlationId === correlationId &&
      event.messageId === messageId &&
      event.jobId === enqueuedJobId
  )
) {
  missing.push("api.mail.notification.enqueued");
}
if (
  !finalWorkerEvents.some(
    (event) =>
      event.event === "job.start" &&
      event.correlationId === correlationId &&
      event.jobId === enqueuedJobId &&
      event.queueName === "mail_notifications"
  )
) {
  missing.push("worker.job.start");
}
if (
  !finalWorkerEvents.some(
    (event) =>
      (event.event === "job.done" || event.event === "job.error") &&
      event.correlationId === correlationId &&
      event.jobId === enqueuedJobId &&
      event.queueName === "mail_notifications"
  )
) {
  missing.push("worker.job.done_or_error");
}

fail({
  correlationId,
  reason: `timeout_after_${logTimeoutMs}ms`,
  missing
});
