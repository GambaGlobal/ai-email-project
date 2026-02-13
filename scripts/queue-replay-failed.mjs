import { Queue } from "bullmq";
import IORedis from "ioredis";

const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

function readNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(`queue:replay: invalid ${name}="${raw}", using ${fallback}`);
    return fallback;
  }
  return Math.floor(value);
}

function truncate(value, max) {
  if (!value) {
    return "";
  }
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function shellValue(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function buildReplayCommand({
  redisUrl,
  queueName,
  limit,
  tenantId,
  correlationId,
  sinceMinutes,
  replayConfirm
}) {
  const parts = [
    `REDIS_URL=${shellValue(redisUrl)}`,
    `QUEUE_NAME=${shellValue(queueName)}`,
    `LIMIT=${shellValue(limit)}`
  ];

  if (tenantId) {
    parts.push(`TENANT_ID=${shellValue(tenantId)}`);
  }
  if (correlationId) {
    parts.push(`CORRELATION_ID=${shellValue(correlationId)}`);
  }
  if (sinceMinutes) {
    parts.push(`SINCE_MINUTES=${shellValue(sinceMinutes)}`);
  }
  if (replayConfirm) {
    parts.push("REPLAY_CONFIRM=1");
  }

  parts.push("pnpm -w queue:replay");
  return parts.join(" ");
}

function jobTime(job) {
  return job.finishedOn ?? job.processedOn ?? job.timestamp ?? 0;
}

const redisUrl = process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
const queueName = process.env.QUEUE_NAME ?? "docs_ingestion";
const limit = readNumberEnv("LIMIT", 50);
const tenantId = process.env.TENANT_ID;
const correlationId = process.env.CORRELATION_ID;
const sinceMinutes = process.env.SINCE_MINUTES ? readNumberEnv("SINCE_MINUTES", 0) : 0;
const replayConfirm = process.env.REPLAY_CONFIRM === "1";

if (!process.env.REDIS_URL) {
  console.warn(`queue:replay: REDIS_URL not set, defaulting to ${DEFAULT_REDIS_URL}`);
}

const now = Date.now();
const sinceCutoff = sinceMinutes > 0 ? now - sinceMinutes * 60 * 1000 : null;

const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

const queue = new Queue(queueName, { connection: redis });

try {
  const failedJobs = await queue.getJobs(["failed"], 0, limit - 1, false);
  const scannedCount = failedJobs.length;
  const matches = failedJobs.filter((job) => {
    const jobTenantId = job.data?.tenantId;
    const jobCorrelationId = job.data?.correlationId;
    if (tenantId && jobTenantId !== tenantId) {
      return false;
    }
    if (correlationId && jobCorrelationId !== correlationId) {
      return false;
    }
    if (sinceCutoff !== null && jobTime(job) < sinceCutoff) {
      return false;
    }
    return true;
  });

  console.log("queue:replay summary");
  console.log(`- queue: ${queueName}`);
  console.log(`- scanned: ${scannedCount}`);
  console.log(`- matched: ${matches.length}`);
  console.log(`- replay mode: ${replayConfirm ? "CONFIRM" : "DRY RUN"}`);

  if (matches.length > 0) {
    console.log("");
    console.log("jobId correlationId tenantId attemptsMade failedReason when");
    for (const job of matches) {
      const whenIso = jobTime(job) > 0 ? new Date(jobTime(job)).toISOString() : "n/a";
      console.log(
        `${job.id ?? "n/a"} ${job.data?.correlationId ?? "n/a"} ${job.data?.tenantId ?? "n/a"} ${
          job.attemptsMade
        } ${truncate(job.failedReason ?? "", 80) || "n/a"} ${whenIso}`
      );
    }
  }

  const dryRunCommand = buildReplayCommand({
    redisUrl,
    queueName,
    limit,
    tenantId,
    correlationId,
    sinceMinutes,
    replayConfirm: false
  });
  const confirmCommand = buildReplayCommand({
    redisUrl,
    queueName,
    limit,
    tenantId,
    correlationId,
    sinceMinutes,
    replayConfirm: true
  });

  if (matches.length === 0) {
    console.log("");
    console.log("No failed jobs matched filters.");
    console.log(`Re-run with same filters: ${dryRunCommand}`);
    process.exit(0);
  }

  if (!replayConfirm) {
    console.log("");
    console.log("DRY RUN - set REPLAY_CONFIRM=1 to replay matched failed jobs.");
    console.log(`Re-run with same filters: ${dryRunCommand}`);
    console.log(`Replay command: ${confirmCommand}`);
    process.exit(0);
  }

  let replayedCount = 0;
  const replayFailures = [];

  for (const job of matches) {
    try {
      await job.retry();
      replayedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      replayFailures.push({ jobId: String(job.id ?? "n/a"), message });
    }
  }

  console.log("");
  console.log("queue:replay results");
  console.log(`- scanned: ${scannedCount}`);
  console.log(`- matched: ${matches.length}`);
  console.log(`- replayed: ${replayedCount}`);
  console.log(`- failed: ${replayFailures.length}`);
  console.log(`Re-run with same filters: ${dryRunCommand}`);
  console.log(`Replay command: ${confirmCommand}`);

  if (replayFailures.length > 0) {
    console.error("Replay failures:");
    for (const failure of replayFailures) {
      console.error(`- jobId=${failure.jobId} error=${failure.message}`);
    }
    process.exit(1);
  }

  process.exit(0);
} finally {
  await queue.close();
  await redis.quit();
}
