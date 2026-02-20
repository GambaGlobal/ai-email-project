import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SCRIPT_PATH = fileURLToPath(new URL("./ops-monitor.mjs", import.meta.url));

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

function shellValue(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function emitError(errorMessage, reason = null) {
  console.error(
    JSON.stringify({
      event: "ops.alertDrill.error",
      reason,
      errorMessage
    })
  );
}

function parseJsonLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((line) => line !== null);
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

function runMonitor(input) {
  const env = {
    ...process.env,
    REDIS_URL: input.redisUrl,
    DATABASE_URL: input.databaseUrl,
    TENANT_ID: input.tenantId,
    QUEUE_NAME: input.queueName
  };

  if (input.monitorWindowMinutes !== null) {
    env.WINDOW_MINUTES = String(input.monitorWindowMinutes);
  }

  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    env,
    encoding: "utf8"
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const jsonLines = parseJsonLines(stdout);
  const thresholds = jsonLines.find((line) => line.event === "ops.monitor.thresholds") ?? null;

  let status = null;
  if (thresholds && typeof thresholds.status === "string") {
    status = thresholds.status;
  }

  return {
    exitCode: result.status,
    signal: result.signal,
    status,
    reasons: Array.isArray(thresholds?.reasons) ? thresholds.reasons : [],
    stdout,
    stderr
  };
}

function printMonitorSummary(event, monitorResult) {
  console.log(
    JSON.stringify({
      event,
      monitorExitCode: monitorResult.exitCode,
      monitorStatus: monitorResult.status,
      monitorReasons: monitorResult.reasons,
      monitorSignal: monitorResult.signal
    })
  );
}

async function main() {
  const redisUrl = process.env.REDIS_URL;
  const databaseUrl = process.env.DATABASE_URL;
  const tenantId = (process.env.TENANT_ID ?? DEFAULT_TENANT_ID).trim();
  const queueName = (process.env.QUEUE_NAME ?? "docs_ingestion").trim();
  const apiUrl = (process.env.API_URL ?? "http://127.0.0.1:3001").trim();
  const drillMode = (process.env.DRILL_MODE ?? "alert").trim();
  const drillTag = (process.env.DRILL_TAG ?? "ops-alert-drill").trim();
  const keepState = process.env.KEEP_STATE === "1";
  const confirmed = process.env.ALERT_DRILL_CONFIRM === "1";
  const allowProdDrill = process.env.ALLOW_PROD_DRILL === "1";
  const monitorWindowMinutes = toIntInRange(process.env.MONITOR_WINDOW_MINUTES, 15, 1, 1440);

  if (!redisUrl) {
    emitError("REDIS_URL is required", "VALIDATION_ERROR");
    process.exit(1);
  }
  if (!databaseUrl) {
    emitError("DATABASE_URL is required", "VALIDATION_ERROR");
    process.exit(1);
  }
  if (!tenantId || !UUID_PATTERN.test(tenantId)) {
    emitError("TENANT_ID must be a UUID", "VALIDATION_ERROR");
    process.exit(1);
  }
  if (!queueName) {
    emitError("QUEUE_NAME must not be empty", "VALIDATION_ERROR");
    process.exit(1);
  }
  if (!drillTag) {
    emitError("DRILL_TAG must not be empty", "VALIDATION_ERROR");
    process.exit(1);
  }
  if (drillMode !== "alert") {
    emitError('DRILL_MODE must be "alert" for v1', "VALIDATION_ERROR");
    process.exit(1);
  }
  if (monitorWindowMinutes === null) {
    emitError("MONITOR_WINDOW_MINUTES must be an integer 1..1440", "VALIDATION_ERROR");
    process.exit(1);
  }

  if (process.env.NODE_ENV === "production" && !allowProdDrill) {
    emitError("Refusing to run in production without ALLOW_PROD_DRILL=1", "PROD_GUARD");
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

  const drillRunId = `${Date.now()}`;
  const syntheticCorrelationId = `${drillTag}:${drillRunId}`;
  const syntheticJobId = `${drillTag}:job:${drillRunId}`;
  const dryRun = !confirmed;

  const rerunConfirm = [
    `REDIS_URL=${shellValue(redisUrl)}`,
    `DATABASE_URL=${shellValue(databaseUrl)}`,
    `TENANT_ID=${shellValue(tenantId)}`,
    `QUEUE_NAME=${shellValue(queueName)}`,
    `DRILL_MODE=${shellValue(drillMode)}`,
    `DRILL_TAG=${shellValue(drillTag)}`,
    `MONITOR_WINDOW_MINUTES=${shellValue(String(monitorWindowMinutes))}`,
    "ALERT_DRILL_CONFIRM=1",
    "pnpm -w ops:alert-drill"
  ].join(" ");

  const cleanupHint = [
    `REDIS_URL=${shellValue(redisUrl)}`,
    `DATABASE_URL=${shellValue(databaseUrl)}`,
    `TENANT_ID=${shellValue(tenantId)}`,
    `DRILL_TAG=${shellValue(drillTag)}`,
    `QUEUE_NAME=${shellValue(queueName)}`,
    "ALERT_DRILL_CONFIRM=1",
    "pnpm -w ops:alert-drill"
  ].join(" ");

  console.log(
    JSON.stringify({
      event: "ops.alertDrill.start",
      drillMode,
      tenantId,
      queueName,
      drillTag,
      drillRunId,
      dryRun,
      keepState,
      monitorWindowMinutes,
      redisUrlHost,
      dbHost,
      apiUrl,
      nodeEnv: process.env.NODE_ENV ?? null
    })
  );

  console.log(
    JSON.stringify({
      event: "ops.alertDrill.plan",
      steps: [
        "pause_queue",
        "insert_synthetic_failure",
        "verify_monitor_alert",
        "cleanup_resume_and_delete",
        "verify_monitor_ok"
      ]
    })
  );

  if (dryRun) {
    console.log(
      JSON.stringify({
        event: "ops.alertDrill.dryRun",
        message: "DRY RUN - set ALERT_DRILL_CONFIRM=1 to apply mutations",
        rerunWithConfirm: rerunConfirm
      })
    );
    console.log(`Re-run with confirm: ${rerunConfirm}`);
    console.log(
      `OK ops:alert-drill status=DRY_RUN tenantId=${tenantId} queue=${queueName} keepState=${keepState ? 1 : 0}`
    );
    process.exit(0);
  }

  const psqlBin = resolvePsqlBin();
  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  const queue = new Queue(queueName, { connection: redis });

  let initialPaused = false;
  let pauseChanged = false;
  let insertedSynthetic = false;

  const attemptCleanup = async () => {
    if (keepState) {
      console.log(
        JSON.stringify({
          event: "ops.alertDrill.cleanup.skipped",
          reason: "KEEP_STATE=1"
        })
      );
      return;
    }

    if (pauseChanged) {
      await queue.resume(false);
      console.log(
        JSON.stringify({
          event: "ops.alertDrill.cleanup.resume",
          queueName,
          resumed: true
        })
      );
    } else {
      console.log(
        JSON.stringify({
          event: "ops.alertDrill.cleanup.resume",
          queueName,
          resumed: false,
          reason: "queue_was_already_paused"
        })
      );
    }

    if (insertedSynthetic) {
      const cleanupSql = `
DELETE FROM doc_ingestion_failures
WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid
  AND correlation_id = ${sqlLiteral(syntheticCorrelationId)}
  AND error_code = 'OPS_ALERT_DRILL';
`;
      const cleanupResult = await runTenantSql(psqlBin, databaseUrl, tenantId, cleanupSql);
      if (!cleanupResult.ok) {
        throw new Error((cleanupResult.stderr || "failed to cleanup synthetic failure row").trim());
      }

      console.log(
        JSON.stringify({
          event: "ops.alertDrill.cleanup.syntheticDeleted",
          tenantId,
          correlationId: syntheticCorrelationId,
          errorCode: "OPS_ALERT_DRILL"
        })
      );
    }
  };

  try {
    initialPaused = await queue.isPaused();
    if (!initialPaused) {
      await queue.pause(false);
      pauseChanged = true;
    }

    console.log(
      JSON.stringify({
        event: "ops.alertDrill.queue.pause",
        queueName,
        queueInitiallyPaused: initialPaused,
        pauseChanged,
        queuePaused: await queue.isPaused()
      })
    );

    const insertSql = `
INSERT INTO doc_ingestion_failures (
  tenant_id,
  correlation_id,
  job_id,
  stage,
  error_class,
  error_code,
  error_message,
  attempt,
  max_attempts
) VALUES (
  ${sqlLiteral(tenantId)}::uuid,
  ${sqlLiteral(syntheticCorrelationId)},
  ${sqlLiteral(syntheticJobId)},
  'doc_ingestion',
  'PERMANENT',
  'OPS_ALERT_DRILL',
  ${sqlLiteral(`Synthetic alert drill failure tag=${drillTag} run=${drillRunId}`)},
  1,
  1
);
`;
    const insertResult = await runTenantSql(psqlBin, databaseUrl, tenantId, insertSql);
    if (!insertResult.ok) {
      throw new Error((insertResult.stderr || "failed to insert synthetic drill failure").trim());
    }
    insertedSynthetic = true;

    console.log(
      JSON.stringify({
        event: "ops.alertDrill.db.syntheticInserted",
        tenantId,
        correlationId: syntheticCorrelationId,
        jobId: syntheticJobId,
        errorCode: "OPS_ALERT_DRILL"
      })
    );

    const monitorAlert = runMonitor({
      redisUrl,
      databaseUrl,
      tenantId,
      queueName,
      monitorWindowMinutes
    });
    printMonitorSummary("ops.alertDrill.monitor.alertCheck", monitorAlert);

    const alertObserved = monitorAlert.exitCode === 2 || monitorAlert.status === "ALERT";
    if (!alertObserved) {
      await attemptCleanup();
      console.error(
        `FAIL ops:alert-drill status=FAIL reason=alert-not-observed queue=${queueName} tenantId=${tenantId}`
      );
      console.error(`Re-run drill with confirm: ${rerunConfirm}`);
      console.error(`Cleanup command: ${cleanupHint}`);
      process.exit(1);
    }

    if (!keepState) {
      await attemptCleanup();

      const monitorOk = runMonitor({
        redisUrl,
        databaseUrl,
        tenantId,
        queueName,
        monitorWindowMinutes
      });
      printMonitorSummary("ops.alertDrill.monitor.okCheck", monitorOk);

      const okObserved = monitorOk.exitCode === 0 && monitorOk.status === "OK";
      if (!okObserved) {
        console.error(
          `FAIL ops:alert-drill status=FAIL reason=ok-not-observed-after-cleanup queue=${queueName} tenantId=${tenantId}`
        );
        console.error(`Cleanup command: ${cleanupHint}`);
        process.exit(1);
      }
    }

    console.log(`OK ops:alert-drill status=PASS tenantId=${tenantId} queue=${queueName} keepState=${keepState ? 1 : 0}`);
    process.exit(0);
  } catch (error) {
    if (!keepState) {
      try {
        await attemptCleanup();
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.error(
          JSON.stringify({
            event: "ops.alertDrill.cleanup.error",
            errorMessage: cleanupMessage
          })
        );
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    emitError(message, "UNEXPECTED_ERROR");
    console.error(`FAIL ops:alert-drill status=FAIL reason=unexpected-error`);
    console.error(`Cleanup command: ${cleanupHint}`);
    process.exit(1);
  } finally {
    await queue.close();
    await redis.quit();
  }
}

void main();
