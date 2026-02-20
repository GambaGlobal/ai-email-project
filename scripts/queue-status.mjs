import { Queue } from "bullmq";
import IORedis from "ioredis";

function toIntInRange(input, fallback, min, max) {
  if (input === undefined) {
    return fallback;
  }
  const value = Number(input);
  if (!Number.isInteger(value) || value < min || value > max) {
    return null;
  }
  return value;
}

function truncateSingleLine(value, max) {
  const oneLine = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 3)}...`;
}

function parseRedisHost(redisUrl) {
  const parsed = new URL(redisUrl);
  return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
}

function asSortableId(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

function activeStartTime(job) {
  return job.processedOn ?? job.timestamp ?? 0;
}

function failedTime(job) {
  return job.finishedOn ?? job.processedOn ?? job.timestamp ?? 0;
}

function sampleMatches(job, tenantId, correlationId) {
  if (tenantId && job.data?.tenantId !== tenantId) {
    return false;
  }
  if (correlationId && job.data?.correlationId !== correlationId) {
    return false;
  }
  return true;
}

async function main() {
  const redisUrl = process.env.REDIS_URL;
  const queueName = process.env.QUEUE_NAME ?? "docs_ingestion";
  const limit = toIntInRange(process.env.LIMIT, 5, 1, 50);
  const sinceMinutes = toIntInRange(process.env.SINCE_MINUTES, 60, 1, 10_080);
  const tenantId = process.env.TENANT_ID ?? null;
  const correlationId = process.env.CORRELATION_ID ?? null;

  if (!redisUrl) {
    console.error(
      JSON.stringify({
        event: "queue.status.error",
        message: "REDIS_URL is required"
      })
    );
    console.error('queue:status: REDIS_URL is required, e.g. REDIS_URL="redis://127.0.0.1:6379"');
    process.exit(1);
  }

  if (!queueName.trim()) {
    console.error(JSON.stringify({ event: "queue.status.error", message: "QUEUE_NAME must not be empty" }));
    console.error("queue:status: QUEUE_NAME must not be empty");
    process.exit(1);
  }

  if (limit === null) {
    console.error(JSON.stringify({ event: "queue.status.error", message: "LIMIT must be an integer 1..50" }));
    console.error("queue:status: LIMIT must be an integer 1..50");
    process.exit(1);
  }

  if (sinceMinutes === null) {
    console.error(
      JSON.stringify({ event: "queue.status.error", message: "SINCE_MINUTES must be an integer 1..10080" })
    );
    console.error("queue:status: SINCE_MINUTES must be an integer 1..10080");
    process.exit(1);
  }

  let redisHost;
  try {
    redisHost = parseRedisHost(redisUrl);
  } catch {
    console.error(JSON.stringify({ event: "queue.status.error", message: "REDIS_URL is not a valid URL" }));
    console.error("queue:status: REDIS_URL must be a valid URL like redis://127.0.0.1:6379");
    process.exit(1);
  }

  const now = Date.now();
  const sinceCutoff = now - sinceMinutes * 60 * 1000;
  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  const queue = new Queue(queueName, { connection: redis });

  try {
    console.log(
      JSON.stringify({
        event: "queue.status",
        queueName,
        redisUrlHost: redisHost,
        at: new Date(now).toISOString(),
        limit,
        sinceMinutes,
        tenantId,
        correlationId
      })
    );

    const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
    console.log(
      JSON.stringify({
        event: "queue.counts",
        queueName,
        counts: {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0
        }
      })
    );

    const activeJobs = await queue.getJobs(["active"], 0, limit - 1, false);
    const activeSamples = activeJobs
      .filter((job) => sampleMatches(job, tenantId, correlationId))
      .sort((a, b) => {
        const timeDelta = activeStartTime(a) - activeStartTime(b);
        if (timeDelta !== 0) {
          return timeDelta;
        }
        return asSortableId(a.id).localeCompare(asSortableId(b.id));
      })
      .slice(0, limit);

    if (activeSamples.length === 0) {
      console.log("info: no active jobs");
    } else {
      for (const job of activeSamples) {
        const start = activeStartTime(job) || now;
        console.log(
          JSON.stringify({
            event: "queue.active",
            queueName,
            jobId: job.id?.toString() ?? null,
            ageMs: Math.max(0, now - start),
            tenantId: job.data?.tenantId ?? null,
            correlationId: job.data?.correlationId ?? null,
            attemptsMade: job.attemptsMade ?? 0,
            maxAttempts: job.opts?.attempts ?? null,
            name: job.name ?? null
          })
        );
      }
    }

    const failedFetchLimit = Math.max(limit * 10, limit);
    const failedJobs = await queue.getJobs(["failed"], 0, failedFetchLimit - 1, false);
    const failedSamples = failedJobs
      .filter((job) => sampleMatches(job, tenantId, correlationId))
      .filter((job) => {
        const time = failedTime(job);
        return time === 0 ? true : time >= sinceCutoff;
      })
      .sort((a, b) => {
        const timeDelta = failedTime(b) - failedTime(a);
        if (timeDelta !== 0) {
          return timeDelta;
        }
        return asSortableId(b.id).localeCompare(asSortableId(a.id));
      })
      .slice(0, limit);

    if (failedSamples.length === 0) {
      console.log("info: no failed jobs");
    } else {
      for (const job of failedSamples) {
        const time = failedTime(job) || now;
        const errorClass = typeof job.data?.errorClass === "string" ? job.data.errorClass : "unknown";
        console.log(
          JSON.stringify({
            event: "queue.failed",
            queueName,
            jobId: job.id?.toString() ?? null,
            failedAgeMs: Math.max(0, now - time),
            tenantId: job.data?.tenantId ?? null,
            correlationId: job.data?.correlationId ?? null,
            attemptsMade: job.attemptsMade ?? 0,
            maxAttempts: job.opts?.attempts ?? null,
            errorClass,
            failedReason: truncateSingleLine(job.failedReason, 240)
          })
        );
      }
    }

    console.log(
      `OK queue:status queue=${queueName} counts waiting=${counts.waiting ?? 0} active=${
        counts.active ?? 0
      } delayed=${counts.delayed ?? 0} failed=${counts.failed ?? 0} completed=${counts.completed ?? 0}`
    );
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        event: "queue.status.error",
        queueName,
        message
      })
    );
    console.error(`queue:status: ${message}`);
    process.exit(1);
  } finally {
    await queue.close();
    await redis.quit();
  }
}

void main();
