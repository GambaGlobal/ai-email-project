import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL;
const databaseUrl = process.env.DATABASE_URL;
const tenantId = process.env.TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
const workerLogPath = process.env.AI_EMAIL_WORKER_LOG ?? "/tmp/ai-email-worker.log";
const logTimeoutMs = Number(process.env.SMOKE_LOG_TIMEOUT_MS ?? 15000);
const pollMs = 250;

function fail(input) {
  console.error(`FAIL: smoke:notify-poison correlationId=${input.correlationId} reason=${input.reason}`);
  if (input.extra) {
    console.error(input.extra);
  }
  console.error(`smoke: grep worker logs: rg -a "${input.correlationId}" "${workerLogPath}"`);
  process.exit(1);
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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

if (!redisUrl) {
  fail({
    correlationId: "unknown",
    reason: "missing_REDIS_URL",
    extra: 'set REDIS_URL, e.g. REDIS_URL="redis://127.0.0.1:6379"'
  });
}

if (!databaseUrl) {
  fail({
    correlationId: "unknown",
    reason: "missing_DATABASE_URL",
    extra: 'set DATABASE_URL, e.g. DATABASE_URL="postgresql://127.0.0.1:5432/ai_email_dev"'
  });
}

const correlationId = randomUUID();
const receiptId = randomUUID();
const jobId = `mail_notification-poison-${correlationId}`;

const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});
const queue = new Queue("mail_notifications", { connection: redis });

try {
  await queue.add(
    "mail.notification",
    {
      tenantId,
      provider: "gmail",
      stage: "mail_notification",
      correlationId,
      messageId: `poison-msg-${randomUUID()}`,
      receiptId,
      gmailHistoryId: "1",
      emailAddress: "poison@example.com",
      mailboxId: null
    },
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 500 }
    }
  );

  const deadline = Date.now() + logTimeoutMs;
  let passed = false;
  while (Date.now() <= deadline) {
    const workerLog = await readLog(workerLogPath);
    const events = collectEvents(workerLog).filter((event) => event.correlationId === correlationId);

    const starts = events.filter(
      (event) =>
        event.event === "job.start" &&
        event.queueName === "mail_notifications" &&
        event.jobId === jobId
    );
    const errors = events.filter(
      (event) =>
        event.event === "job.error" &&
        event.queueName === "mail_notifications" &&
        event.jobId === jobId
    );

    const retried = starts.some((event) => Number(event.attempt ?? 0) >= 2);
    if (retried) {
      fail({
        correlationId,
        reason: "unexpected_retry_attempt"
      });
    }

    const hasStartAttemptOne = starts.some((event) => Number(event.attempt ?? 0) === 1);
    const hasPermanentError = errors.some((event) => event.errorClass === "PERMANENT");
    if (hasStartAttemptOne && hasPermanentError) {
      passed = true;
      break;
    }

    await sleep(pollMs);
  }

  if (!passed) {
    fail({
      correlationId,
      reason: `timeout_after_${logTimeoutMs}ms`,
      extra: "expected one permanent job.error without retry attempts"
    });
  }

  console.log(`PASS: smoke:notify-poison correlationId=${correlationId} jobId=${jobId}`);
} finally {
  try {
    const job = await queue.getJob(jobId);
    if (job) {
      await job.remove();
    }
  } catch {
    // best effort cleanup
  }

  await queue.close();
  await redis.quit();
}
