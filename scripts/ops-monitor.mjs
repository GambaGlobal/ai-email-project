import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toIntInRange(raw, fallback, min, max) {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}

function toFloatInRange(raw, fallback, min, max) {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}

function normalizeBoolTruthy(raw) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
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

function parseUrlHost(urlValue, label) {
  let parsed;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }

  if (!parsed.hostname) {
    throw new Error(`${label} must include host`);
  }

  const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  const dbName = label === "DATABASE_URL" ? parsed.pathname.replace(/^\/+/, "") || null : null;

  return { host, dbName };
}

function parseNumericResult(stdout) {
  const line = stdout
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => /^-?[0-9]+(\.[0-9]+)?$/.test(value))
    .at(-1);
  return Number(line ?? "0");
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
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on("error", (error) => {
      resolve({ ok: false, stdout, stderr: `${psqlBin}: ${error.message}` });
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

function emitError(errorMessage) {
  console.error(
    JSON.stringify({
      event: "ops.monitor.error",
      errorMessage
    })
  );
}

function evaluateThresholds(input) {
  const reasons = [];
  let status = "OK";

  const markWarn = (reason) => {
    reasons.push(reason);
    if (status === "OK") {
      status = "WARN";
    }
  };

  const markAlert = (reason) => {
    reasons.push(reason);
    status = "ALERT";
  };

  if (input.queuePaused) {
    markAlert("queue_paused");
  }

  if (input.stuckCount >= input.alertStuck) {
    markAlert("stuck_processing_alert");
  } else if (input.stuckCount >= input.warnStuck) {
    markWarn("stuck_processing_warn");
  }

  if (input.failedRate >= input.alertFailedRate) {
    markAlert("failed_rate_alert");
  } else if (input.failedRate >= input.warnFailedRate) {
    markWarn("failed_rate_warn");
  }

  if (input.waitingCount >= input.alertWaiting) {
    markAlert("queue_waiting_alert");
  } else if (input.waitingCount >= input.warnWaiting) {
    markWarn("queue_waiting_warn");
  }

  return {
    status,
    reasons
  };
}

function deriveDocIdFromJobId(jobId) {
  if (typeof jobId !== "string") {
    return null;
  }
  const prefix = "docs_ingestion-";
  if (!jobId.startsWith(prefix)) {
    return null;
  }
  const maybeDocId = jobId.slice(prefix.length);
  return UUID_PATTERN.test(maybeDocId) ? maybeDocId : null;
}

async function main() {
  const redisUrl = process.env.REDIS_URL;
  const databaseUrl = process.env.DATABASE_URL;
  const tenantId = (process.env.TENANT_ID ?? DEFAULT_TENANT_ID).trim();
  const queueName = (process.env.QUEUE_NAME ?? "docs_ingestion").trim();

  const windowMinutes = toIntInRange(process.env.WINDOW_MINUTES, 15, 1, 1440);
  const stuckThresholdMinutes = toIntInRange(process.env.STUCK_THRESHOLD_MINUTES, 60, 1, 10_080);
  const limit = toIntInRange(process.env.LIMIT, 5, 1, 50);

  const warnFailedRate = toFloatInRange(process.env.WARN_FAILED_RATE, 0.1, 0, 1);
  const alertFailedRate = toFloatInRange(process.env.ALERT_FAILED_RATE, 0.2, 0, 1);
  const warnWaiting = toIntInRange(process.env.WARN_WAITING, 50, 0, 1_000_000);
  const alertWaiting = toIntInRange(process.env.ALERT_WAITING, 200, 0, 1_000_000);
  const warnStuck = toIntInRange(process.env.WARN_STUCK, 1, 0, 1_000_000);
  const alertStuck = toIntInRange(process.env.ALERT_STUCK, 5, 0, 1_000_000);

  if (!redisUrl) {
    emitError("REDIS_URL is required");
    process.exit(1);
  }
  if (!databaseUrl) {
    emitError("DATABASE_URL is required");
    process.exit(1);
  }
  if (!tenantId || !UUID_PATTERN.test(tenantId)) {
    emitError("TENANT_ID must be a UUID (or omitted to use default pilot tenant)");
    process.exit(1);
  }
  if (!queueName) {
    emitError("QUEUE_NAME must not be empty");
    process.exit(1);
  }

  if (windowMinutes === null || stuckThresholdMinutes === null || limit === null) {
    emitError("WINDOW_MINUTES/STUCK_THRESHOLD_MINUTES/LIMIT contain invalid values");
    process.exit(1);
  }
  if (
    warnFailedRate === null ||
    alertFailedRate === null ||
    warnWaiting === null ||
    alertWaiting === null ||
    warnStuck === null ||
    alertStuck === null
  ) {
    emitError("Threshold env values are invalid");
    process.exit(1);
  }
  if (warnFailedRate > alertFailedRate) {
    emitError("WARN_FAILED_RATE must be <= ALERT_FAILED_RATE");
    process.exit(1);
  }
  if (warnWaiting > alertWaiting) {
    emitError("WARN_WAITING must be <= ALERT_WAITING");
    process.exit(1);
  }
  if (warnStuck > alertStuck) {
    emitError("WARN_STUCK must be <= ALERT_STUCK");
    process.exit(1);
  }

  let redisHost;
  let dbHost;
  let dbName;
  try {
    const redisParsed = parseUrlHost(redisUrl, "REDIS_URL");
    const dbParsed = parseUrlHost(databaseUrl, "DATABASE_URL");
    redisHost = redisParsed.host;
    dbHost = dbParsed.host;
    dbName = dbParsed.dbName;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitError(message);
    process.exit(1);
  }

  const now = Date.now();
  const sinceCutoffMs = now - windowMinutes * 60 * 1000;
  const failedFetchLimit = Math.max(limit * 20, limit);

  const psqlBin = resolvePsqlBin();
  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  const queue = new Queue(queueName, { connection: redis });

  try {
    console.log(
      JSON.stringify({
        event: "ops.monitor.start",
        tenantId,
        queueName,
        windowMinutes,
        stuckThresholdMinutes,
        limit,
        thresholds: {
          warnFailedRate,
          alertFailedRate,
          warnWaiting,
          alertWaiting,
          warnStuck,
          alertStuck
        },
        redisUrlHost: redisHost,
        dbHost,
        dbName,
        at: new Date(now).toISOString()
      })
    );

    const killSwitchSql = `
SELECT json_build_object(
  'isEnabled', is_enabled,
  'reason', reason,
  'updatedAt', updated_at
)::text
FROM tenant_kill_switches
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND key = 'docs_ingestion'
ORDER BY updated_at DESC
LIMIT 1;
`;
    const killSwitchResult = await runTenantSql(psqlBin, databaseUrl, tenantId, killSwitchSql);
    if (!killSwitchResult.ok) {
      emitError((killSwitchResult.stderr || "failed to query kill switch").trim());
      process.exit(1);
    }
    const killRows = parseTabJsonRows(killSwitchResult.stdout);
    const tenantKillSwitch = killRows.length > 0 ? JSON.parse(killRows[0]) : null;

    const globalDisabled = normalizeBoolTruthy(process.env.DOCS_INGESTION_DISABLED ?? "");
    console.log(
      JSON.stringify({
        event: "ops.monitor.kill_switches",
        global: {
          disabled: globalDisabled,
          key: "DOCS_INGESTION_DISABLED"
        },
        tenant: tenantKillSwitch
          ? {
              status: "set",
              isEnabled: tenantKillSwitch.isEnabled === true,
              reason: tenantKillSwitch.reason ?? null,
              updatedAt: tenantKillSwitch.updatedAt ?? null
            }
          : {
              status: "not_set"
            }
      })
    );

    const isPaused = await queue.isPaused();
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");

    const activeJobs = await queue.getJobs(["active"], 0, failedFetchLimit - 1, false);
    const activeSamples = activeJobs
      .filter((job) => job.data?.tenantId === tenantId)
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
        tenantId: job.data?.tenantId ?? null,
        correlationId: job.data?.correlationId ?? null,
        startedAt: activeStart(job) > 0 ? new Date(activeStart(job)).toISOString() : null,
        ageMs: activeStart(job) > 0 ? Math.max(0, now - activeStart(job)) : null
      }));

    const failedJobs = await queue.getJobs(["failed"], 0, failedFetchLimit - 1, false);
    const failedSamples = failedJobs
      .filter((job) => job.data?.tenantId === tenantId)
      .filter((job) => {
        const when = failedAt(job);
        return when === 0 ? true : when >= sinceCutoffMs;
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
        tenantId: job.data?.tenantId ?? null,
        correlationId: job.data?.correlationId ?? null,
        failedAt: failedAt(job) > 0 ? new Date(failedAt(job)).toISOString() : null,
        failedAgeMs: failedAt(job) > 0 ? Math.max(0, now - failedAt(job)) : null
      }));

    console.log(
      JSON.stringify({
        event: "ops.monitor.queue",
        queueName,
        paused: isPaused,
        counts: {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0
        },
        samples: {
          active: activeSamples,
          failed: failedSamples
        }
      })
    );

    const ingestionWindowSql = `
SELECT json_build_object(
  'doneCount', count(*) FILTER (
    WHERE ingested_at IS NOT NULL
      AND ingested_at >= now() - (${windowMinutes} * interval '1 minute')
  ),
  'failedCount', count(*) FILTER (
    WHERE ingestion_status = 'failed'
      AND ingestion_status_updated_at >= now() - (${windowMinutes} * interval '1 minute')
  )
)::text
FROM docs
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid;
`;

    const ingestionWindowResult = await runTenantSql(psqlBin, databaseUrl, tenantId, ingestionWindowSql);
    if (!ingestionWindowResult.ok) {
      emitError((ingestionWindowResult.stderr || "failed to query ingestion window").trim());
      process.exit(1);
    }

    const ingestionWindowRows = parseTabJsonRows(ingestionWindowResult.stdout);
    const ingestionWindow = ingestionWindowRows.length > 0 ? JSON.parse(ingestionWindowRows[0]) : {};
    const doneCount = Number(ingestionWindow.doneCount ?? 0);
    const failedCount = Number(ingestionWindow.failedCount ?? 0);
    const failedRate = failedCount / Math.max(1, failedCount + doneCount);

    console.log(
      JSON.stringify({
        event: "ops.monitor.ingestion_window",
        tenantId,
        windowMinutes,
        done: doneCount,
        failed: failedCount,
        failedRate: Number(failedRate.toFixed(6))
      })
    );

    const stuckSql = `
SELECT count(*)
FROM docs
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND ingestion_status = 'processing'
  AND ingestion_status_updated_at < now() - (${stuckThresholdMinutes} * interval '1 minute');
`;
    const stuckResult = await runTenantSql(psqlBin, databaseUrl, tenantId, stuckSql);
    if (!stuckResult.ok) {
      emitError((stuckResult.stderr || "failed to query stuck processing docs").trim());
      process.exit(1);
    }
    const stuckCount = parseNumericResult(stuckResult.stdout);

    console.log(
      JSON.stringify({
        event: "ops.monitor.stuck_processing",
        tenantId,
        thresholdMinutes: stuckThresholdMinutes,
        count: stuckCount
      })
    );

    const failuresCountSql = `
SELECT count(*)
FROM doc_ingestion_failures
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND created_at >= now() - (${windowMinutes} * interval '1 minute');
`;
    const failuresSamplesSql = `
SELECT json_build_object(
  'correlationId', correlation_id,
  'jobId', job_id,
  'errorClass', error_class,
  'errorCode', error_code,
  'createdAt', created_at
)::text
FROM doc_ingestion_failures
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND created_at >= now() - (${windowMinutes} * interval '1 minute')
ORDER BY created_at DESC, id DESC
LIMIT ${limit};
`;
    const [failuresCountResult, failuresSamplesResult] = await Promise.all([
      runTenantSql(psqlBin, databaseUrl, tenantId, failuresCountSql),
      runTenantSql(psqlBin, databaseUrl, tenantId, failuresSamplesSql)
    ]);

    if (!failuresCountResult.ok || !failuresSamplesResult.ok) {
      emitError(
        `${(failuresCountResult.stderr || "").trim()} ${(failuresSamplesResult.stderr || "").trim()}`.trim() ||
          "failed to query failures window"
      );
      process.exit(1);
    }

    const failuresWindowCount = parseNumericResult(failuresCountResult.stdout);
    const failureSampleRows = parseTabJsonRows(failuresSamplesResult.stdout)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((row) => row !== null)
      .map((row) => ({
        correlationId: row.correlationId ?? null,
        docId: deriveDocIdFromJobId(row.jobId),
        jobId: row.jobId ?? null,
        errorClass: row.errorClass ?? null,
        errorCode: row.errorCode ?? null,
        createdAt: row.createdAt ?? null
      }));

    console.log(
      JSON.stringify({
        event: "ops.monitor.failures_window",
        tenantId,
        windowMinutes,
        count: failuresWindowCount,
        samples: failureSampleRows
      })
    );

    const thresholdResult = evaluateThresholds({
      queuePaused: isPaused,
      stuckCount,
      failedRate,
      waitingCount: counts.waiting ?? 0,
      warnFailedRate,
      alertFailedRate,
      warnWaiting,
      alertWaiting,
      warnStuck,
      alertStuck
    });

    console.log(
      JSON.stringify({
        event: "ops.monitor.thresholds",
        status: thresholdResult.status,
        reasons: thresholdResult.reasons
      })
    );

    if (thresholdResult.status === "ALERT") {
      console.log(
        `FAIL ops:monitor status=ALERT tenantId=${tenantId} queue=${queueName} windowMinutes=${windowMinutes}`
      );
      process.exit(2);
    }

    if (thresholdResult.status === "WARN") {
      console.log(
        `WARN ops:monitor status=WARN tenantId=${tenantId} queue=${queueName} windowMinutes=${windowMinutes}`
      );
      process.exit(0);
    }

    console.log(
      `OK ops:monitor status=OK tenantId=${tenantId} queue=${queueName} windowMinutes=${windowMinutes}`
    );
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitError(message);
    process.exit(1);
  } finally {
    await queue.close();
    await redis.quit();
  }
}

void main();
