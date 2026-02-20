import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function normalizeOptionalString(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBoolTruthy(raw) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function parseHostPort(urlValue, label) {
  let parsed;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!parsed.hostname) {
    throw new Error(`${label} must include a host`);
  }
  return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
}

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

function runTenantSql(psqlBin, databaseUrl, tenantId, sql) {
  const wrapped = `
BEGIN;
SELECT set_config('app.tenant_id', ${sqlLiteral(tenantId)}, true);
${sql}
COMMIT;
`.trim();

  return new Promise((resolve) => {
    const child = spawn(psqlBin, [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "-c", wrapped], {
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
      resolve({ ok: code === 0, stdout, stderr, code: null });
    });
    child.on("error", (error) => {
      resolve({ ok: false, stdout, stderr: `${psqlBin}: ${error.message}`, code: error.code ?? null });
    });
  });
}

function jobSortId(job) {
  if (job.id === undefined || job.id === null) {
    return "";
  }
  return String(job.id);
}

function activeStart(job) {
  return job.processedOn ?? job.timestamp ?? 0;
}

function failedAt(job) {
  return job.finishedOn ?? job.processedOn ?? job.timestamp ?? 0;
}

function queueJobMatches(job, tenantId, correlationId) {
  if (tenantId && job.data?.tenantId !== tenantId) {
    return false;
  }
  if (correlationId && job.data?.correlationId !== correlationId) {
    return false;
  }
  return true;
}

async function collectQueueSnapshot({
  queue,
  queueName,
  tenantId,
  correlationId,
  sinceCutoffMs,
  sampleLimit,
  fetchLimit,
  now
}) {
  const isPaused = await queue.isPaused();
  const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");

  const activeJobs = await queue.getJobs(["active"], 0, fetchLimit - 1, false);
  const activeSamples = activeJobs
    .filter((job) => queueJobMatches(job, tenantId, correlationId))
    .sort((a, b) => {
      const timeDelta = activeStart(a) - activeStart(b);
      if (timeDelta !== 0) {
        return timeDelta;
      }
      return jobSortId(a).localeCompare(jobSortId(b));
    })
    .slice(0, sampleLimit)
    .map((job) => ({
      jobId: job.id?.toString() ?? null,
      name: job.name ?? null,
      tenantId: job.data?.tenantId ?? null,
      correlationId: job.data?.correlationId ?? null,
      attemptsMade: job.attemptsMade ?? 0,
      maxAttempts: job.opts?.attempts ?? null,
      startedAt: activeStart(job) > 0 ? new Date(activeStart(job)).toISOString() : null,
      ageMs: activeStart(job) > 0 ? Math.max(0, now - activeStart(job)) : null
    }));

  const failedJobs = await queue.getJobs(["failed"], 0, fetchLimit - 1, false);
  const failedSamples = failedJobs
    .filter((job) => queueJobMatches(job, tenantId, correlationId))
    .filter((job) => {
      const at = failedAt(job);
      return at === 0 ? true : at >= sinceCutoffMs;
    })
    .sort((a, b) => {
      const timeDelta = failedAt(b) - failedAt(a);
      if (timeDelta !== 0) {
        return timeDelta;
      }
      return jobSortId(b).localeCompare(jobSortId(a));
    })
    .slice(0, sampleLimit)
    .map((job) => ({
      jobId: job.id?.toString() ?? null,
      name: job.name ?? null,
      tenantId: job.data?.tenantId ?? null,
      correlationId: job.data?.correlationId ?? null,
      attemptsMade: job.attemptsMade ?? 0,
      maxAttempts: job.opts?.attempts ?? null,
      finishedAt: failedAt(job) > 0 ? new Date(failedAt(job)).toISOString() : null,
      failedAgeMs: failedAt(job) > 0 ? Math.max(0, now - failedAt(job)) : null,
      failedReason:
        typeof job.failedReason === "string"
          ? job.failedReason.replace(/\s+/g, " ").trim().slice(0, 240)
          : null
    }));

  return {
    queueName,
    isPaused,
    counts: {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0
    },
    activeSamples,
    failedSamples
  };
}

function parseTabJsonRows(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf("\t");
      if (tab === -1) {
        return line;
      }
      return line.slice(tab + 1);
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

function emitError(errorMessage, errorCode = null) {
  console.error(
    JSON.stringify({
      event: "ops.triage.error",
      errorMessage,
      errorCode
    })
  );
}

async function main() {
  const redisUrl = process.env.REDIS_URL;
  const databaseUrl = process.env.DATABASE_URL;
  const tenantId = process.env.TENANT_ID;
  const queueNameRaw = process.env.QUEUE_NAME ?? "docs_ingestion";
  const queueName = queueNameRaw.trim();
  const limit = toIntInRange(process.env.LIMIT, 5, 1, 25);
  const sinceMinutes = toIntInRange(process.env.SINCE_MINUTES, 60, 1, 1440);
  const correlationId = normalizeOptionalString(process.env.CORRELATION_ID);
  const globalRaw = process.env.DOCS_INGESTION_DISABLED ?? "";

  if (!databaseUrl) {
    emitError("DATABASE_URL is required", "VALIDATION_ERROR");
    process.exit(1);
  }
  if (!redisUrl) {
    emitError("REDIS_URL is required", "VALIDATION_ERROR");
    process.exit(1);
  }
  if (!tenantId) {
    emitError("TENANT_ID is required", "VALIDATION_ERROR");
    process.exit(1);
  }
  if (!UUID_PATTERN.test(tenantId)) {
    emitError("TENANT_ID must be a UUID", "VALIDATION_ERROR");
    process.exit(1);
  }
  if (!queueName) {
    emitError("QUEUE_NAME must not be empty", "VALIDATION_ERROR");
    process.exit(1);
  }
  if (limit === null) {
    emitError("LIMIT must be an integer 1..25", "VALIDATION_ERROR");
    process.exit(1);
  }
  if (sinceMinutes === null) {
    emitError("SINCE_MINUTES must be an integer 1..1440", "VALIDATION_ERROR");
    process.exit(1);
  }

  let redisUrlHost;
  let dbHost;
  try {
    redisUrlHost = parseHostPort(redisUrl, "REDIS_URL");
    dbHost = parseHostPort(databaseUrl, "DATABASE_URL");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitError(message, "VALIDATION_ERROR");
    process.exit(1);
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const sinceCutoffMs = now - sinceMinutes * 60 * 1000;
  const failedFetchLimit = Math.max(limit * 20, limit);
  const psqlBin = resolvePsqlBin();

  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  const queue = new Queue(queueName, { connection: redis });
  const mailNotificationsQueue = new Queue("mail_notifications", { connection: redis });
  const mailboxSyncQueue = new Queue("mailbox_sync", { connection: redis });

  try {
    console.log(
      JSON.stringify({
        event: "ops.triage",
        tenantId,
        queueName,
        sinceMinutes,
        limit,
        correlationId,
        redisUrlHost,
        dbHost,
        at: nowIso
      })
    );

    const globalDisabled = normalizeBoolTruthy(globalRaw);
    console.log(
      JSON.stringify({
        event: "ops.triage.killSwitch.global",
        disabled: globalDisabled,
        raw: String(globalRaw)
      })
    );

    const tenantKillSwitchSql = `
SELECT json_build_object(
  'event', 'ops.triage.killSwitch.tenant',
  'key', key,
  'isEnabled', is_enabled,
  'reason', reason,
  'updatedAt', updated_at
)::text
FROM tenant_kill_switches
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND key = 'docs_ingestion'
ORDER BY updated_at DESC, key ASC
LIMIT 1;
`;

    const tenantKillSwitchResult = await runTenantSql(psqlBin, databaseUrl, tenantId, tenantKillSwitchSql);
    if (!tenantKillSwitchResult.ok) {
      const err = tenantKillSwitchResult.stderr.trim() || "failed to query tenant kill switch";
      emitError(err, tenantKillSwitchResult.code ?? "DB_QUERY_FAILED");
      process.exit(1);
    }

    const tenantKillSwitchRows = parseTabJsonRows(tenantKillSwitchResult.stdout);
    if (tenantKillSwitchRows.length === 0) {
      console.log(
        JSON.stringify({
          event: "ops.triage.killSwitch.tenant",
          key: "docs_ingestion",
          status: "not_set"
        })
      );
    } else {
      const tenantKillSwitch = JSON.parse(tenantKillSwitchRows[0]);
      console.log(JSON.stringify(tenantKillSwitch));
    }

    const isPaused = await queue.isPaused();
    console.log(
      JSON.stringify({
        event: "ops.triage.queue.isPaused",
        queueName,
        isPaused
      })
    );

    const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
    console.log(
      JSON.stringify({
        event: "ops.triage.queue.counts",
        queueName,
        counts: {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0
        }
      })
    );

    const activeJobs = await queue.getJobs(["active"], 0, failedFetchLimit - 1, false);
    const activeSamples = activeJobs
      .filter((job) => queueJobMatches(job, tenantId, correlationId))
      .sort((a, b) => {
        const timeDelta = activeStart(a) - activeStart(b);
        if (timeDelta !== 0) {
          return timeDelta;
        }
        return jobSortId(a).localeCompare(jobSortId(b));
      })
      .slice(0, limit)
      .map((job) => ({
        jobId: job.id?.toString() ?? null,
        name: job.name ?? null,
        tenantId: job.data?.tenantId ?? null,
        correlationId: job.data?.correlationId ?? null,
        attemptsMade: job.attemptsMade ?? 0,
        maxAttempts: job.opts?.attempts ?? null,
        startedAt: activeStart(job) > 0 ? new Date(activeStart(job)).toISOString() : null,
        ageMs: activeStart(job) > 0 ? Math.max(0, now - activeStart(job)) : null
      }));

    console.log(
      JSON.stringify({
        event: "ops.triage.queue.samples.active",
        queueName,
        jobs: activeSamples
      })
    );

    const failedJobs = await queue.getJobs(["failed"], 0, failedFetchLimit - 1, false);
    const failedSamples = failedJobs
      .filter((job) => queueJobMatches(job, tenantId, correlationId))
      .filter((job) => {
        const at = failedAt(job);
        return at === 0 ? true : at >= sinceCutoffMs;
      })
      .sort((a, b) => {
        const timeDelta = failedAt(b) - failedAt(a);
        if (timeDelta !== 0) {
          return timeDelta;
        }
        return jobSortId(b).localeCompare(jobSortId(a));
      })
      .slice(0, limit)
      .map((job) => ({
        jobId: job.id?.toString() ?? null,
        name: job.name ?? null,
        tenantId: job.data?.tenantId ?? null,
        correlationId: job.data?.correlationId ?? null,
        attemptsMade: job.attemptsMade ?? 0,
        maxAttempts: job.opts?.attempts ?? null,
        finishedAt: failedAt(job) > 0 ? new Date(failedAt(job)).toISOString() : null,
        failedAgeMs: failedAt(job) > 0 ? Math.max(0, now - failedAt(job)) : null,
        failedReason:
          typeof job.failedReason === "string"
            ? job.failedReason.replace(/\s+/g, " ").trim().slice(0, 240)
            : null
      }));

    console.log(
      JSON.stringify({
        event: "ops.triage.queue.samples.failed",
        queueName,
        sinceMinutes,
        jobs: failedSamples
      })
    );

    const failureFilters = [`tenant_id = ${sqlLiteral(tenantId)}::uuid`, `created_at >= now() - (${sinceMinutes} * interval '1 minute')`];
    if (correlationId) {
      failureFilters.push(`correlation_id = ${sqlLiteral(correlationId)}`);
    }
    const failureWhere = `WHERE ${failureFilters.join(" AND ")}`;

    const failureCountSql = `
SELECT count(*)
FROM doc_ingestion_failures
${failureWhere};
`;

    const failureSamplesSql = `
SELECT json_build_object(
  'id', id,
  'created_at', created_at,
  'job_id', job_id,
  'correlation_id', correlation_id,
  'error_class', error_class,
  'error_code', error_code
)::text
FROM doc_ingestion_failures
${failureWhere}
ORDER BY created_at DESC, id DESC
LIMIT ${limit};
`;

    const [failureCountResult, failureSamplesResult] = await Promise.all([
      runTenantSql(psqlBin, databaseUrl, tenantId, failureCountSql),
      runTenantSql(psqlBin, databaseUrl, tenantId, failureSamplesSql)
    ]);

    if (!failureCountResult.ok || !failureSamplesResult.ok) {
      const stderr = `${failureCountResult.stderr ?? ""}\n${failureSamplesResult.stderr ?? ""}`.trim();
      emitError(stderr || "failed to query doc_ingestion_failures", "DB_QUERY_FAILED");
      process.exit(1);
    }

    const failureCount = parseNumericResult(failureCountResult.stdout);
    const failureRows = parseTabJsonRows(failureSamplesResult.stdout).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter((row) => row !== null);

    console.log(
      JSON.stringify({
        event: "ops.triage.failures.count",
        tenantId,
        sinceMinutes,
        correlationId,
        count: failureCount
      })
    );

    console.log(
      JSON.stringify({
        event: "ops.triage.failures.samples",
        tenantId,
        sinceMinutes,
        rows: failureRows
      })
    );

    const sampleLimit = Math.min(limit, 5);
    const mailNotificationsSnapshot = await collectQueueSnapshot({
      queue: mailNotificationsQueue,
      queueName: "mail_notifications",
      tenantId,
      correlationId,
      sinceCutoffMs,
      sampleLimit,
      fetchLimit: failedFetchLimit,
      now
    });
    console.log(
      JSON.stringify({
        event: "ops.triage.mail.queue.isPaused",
        queueName: mailNotificationsSnapshot.queueName,
        isPaused: mailNotificationsSnapshot.isPaused
      })
    );
    console.log(
      JSON.stringify({
        event: "ops.triage.mail.queue.counts",
        queueName: mailNotificationsSnapshot.queueName,
        counts: mailNotificationsSnapshot.counts
      })
    );
    console.log(
      JSON.stringify({
        event: "ops.triage.mail.queue.samples.active",
        queueName: mailNotificationsSnapshot.queueName,
        jobs: mailNotificationsSnapshot.activeSamples
      })
    );
    console.log(
      JSON.stringify({
        event: "ops.triage.mail.queue.samples.failed",
        queueName: mailNotificationsSnapshot.queueName,
        sinceMinutes,
        jobs: mailNotificationsSnapshot.failedSamples
      })
    );

    const mailboxSyncSnapshot = await collectQueueSnapshot({
      queue: mailboxSyncQueue,
      queueName: "mailbox_sync",
      tenantId,
      correlationId,
      sinceCutoffMs,
      sampleLimit,
      fetchLimit: failedFetchLimit,
      now
    });
    console.log(
      JSON.stringify({
        event: "ops.triage.mailboxSync.queue.isPaused",
        queueName: mailboxSyncSnapshot.queueName,
        isPaused: mailboxSyncSnapshot.isPaused
      })
    );
    console.log(
      JSON.stringify({
        event: "ops.triage.mailboxSync.queue.counts",
        queueName: mailboxSyncSnapshot.queueName,
        counts: mailboxSyncSnapshot.counts
      })
    );
    console.log(
      JSON.stringify({
        event: "ops.triage.mailboxSync.queue.samples.active",
        queueName: mailboxSyncSnapshot.queueName,
        jobs: mailboxSyncSnapshot.activeSamples
      })
    );
    console.log(
      JSON.stringify({
        event: "ops.triage.mailboxSync.queue.samples.failed",
        queueName: mailboxSyncSnapshot.queueName,
        sinceMinutes,
        jobs: mailboxSyncSnapshot.failedSamples
      })
    );

    const receiptFilters = [
      `provider = 'gmail'`,
      `received_at >= now() - (${sinceMinutes} * interval '1 minute')`,
      `tenant_id = ${sqlLiteral(tenantId)}::uuid`
    ];
    if (correlationId) {
      receiptFilters.push(
        `coalesce(payload->>'correlationId', payload->'attributes'->>'correlationId') = ${sqlLiteral(correlationId)}`
      );
    }
    const receiptWhere = `WHERE ${receiptFilters.join(" AND ")}`;

    const receiptStatusSql = `
SELECT json_build_object(
  'received', count(*) FILTER (WHERE processing_status = 'received'),
  'enqueued', count(*) FILTER (WHERE processing_status = 'enqueued'),
  'processing', count(*) FILTER (WHERE processing_status = 'processing'),
  'done', count(*) FILTER (WHERE processing_status = 'done'),
  'failed_transient', count(*) FILTER (WHERE processing_status = 'failed_transient'),
  'failed_permanent', count(*) FILTER (WHERE processing_status = 'failed_permanent'),
  'ignored', count(*) FILTER (WHERE processing_status = 'ignored')
)::text
FROM mail_notification_receipts
${receiptWhere};
`;

    const syncIndicatorsSql = `
SELECT json_build_object(
  'lagCount', count(*) FILTER (WHERE pending_max_history_id > last_history_id),
  'recentErrorCount', count(*) FILTER (WHERE last_error IS NOT NULL AND updated_at >= now() - (${sinceMinutes} * interval '1 minute'))
)::text
FROM mailbox_sync_state
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND provider = 'gmail';
`;

    const [receiptStatusResult, syncIndicatorsResult] = await Promise.all([
      runTenantSql(psqlBin, databaseUrl, tenantId, receiptStatusSql),
      runTenantSql(psqlBin, databaseUrl, tenantId, syncIndicatorsSql)
    ]);
    if (!receiptStatusResult.ok || !syncIndicatorsResult.ok) {
      const stderr = `${receiptStatusResult.stderr ?? ""}\n${syncIndicatorsResult.stderr ?? ""}`.trim();
      emitError(stderr || "failed to query mail triage summaries", "DB_QUERY_FAILED");
      process.exit(1);
    }

    const receiptStatusRows = parseTabJsonRows(receiptStatusResult.stdout);
    const receiptStatus = receiptStatusRows.length > 0 ? JSON.parse(receiptStatusRows[0]) : {};
    console.log(
      JSON.stringify({
        event: "ops.triage.mail.receipts.statusCounts",
        tenantId,
        sinceMinutes,
        counts: {
          received: Number(receiptStatus.received ?? 0),
          enqueued: Number(receiptStatus.enqueued ?? 0),
          processing: Number(receiptStatus.processing ?? 0),
          done: Number(receiptStatus.done ?? 0),
          failed_transient: Number(receiptStatus.failed_transient ?? 0),
          failed_permanent: Number(receiptStatus.failed_permanent ?? 0),
          ignored: Number(receiptStatus.ignored ?? 0)
        }
      })
    );

    const syncRows = parseTabJsonRows(syncIndicatorsResult.stdout);
    const syncIndicators = syncRows.length > 0 ? JSON.parse(syncRows[0]) : {};
    console.log(
      JSON.stringify({
        event: "ops.triage.mailboxSync.indicators",
        tenantId,
        sinceMinutes,
        lagCount: Number(syncIndicators.lagCount ?? 0),
        recentErrorCount: Number(syncIndicators.recentErrorCount ?? 0)
      })
    );

    console.log(`OK ops:triage tenant=${tenantId} queue=${queueName} sinceMinutes=${sinceMinutes} limit=${limit}`);
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode =
      typeof error === "object" && error !== null && "code" in error ? String(error.code ?? "") || null : null;
    emitError(errorMessage, errorCode);
    process.exit(1);
  } finally {
    await queue.close();
    await mailNotificationsQueue.close();
    await mailboxSyncQueue.close();
    await redis.quit();
  }
}

void main();
