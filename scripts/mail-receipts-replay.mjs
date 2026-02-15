import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const VALID_STATUS = new Set([
  "received",
  "enqueued",
  "processing",
  "done",
  "failed_transient",
  "failed_permanent",
  "ignored"
]);
const TERMINAL_STATUS = new Set(["done", "ignored", "failed_permanent"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAIL_NOTIFICATIONS_QUEUE = "mail_notifications";
const MAIL_NOTIFICATION_JOB = "mail.notification";
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 500
  },
  removeOnComplete: 1000,
  removeOnFail: 5000
};

function normalizeOptionalString(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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

function parseHost(urlValue, label) {
  const parsed = new URL(urlValue);
  if (!parsed.hostname) {
    throw new Error(`${label} must include host`);
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

function shellValue(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseStatuses(raw) {
  const parsed = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (parsed.length === 0) {
    return null;
  }

  const deduped = [];
  for (const status of parsed) {
    if (!VALID_STATUS.has(status)) {
      return null;
    }
    if (!deduped.includes(status)) {
      deduped.push(status);
    }
  }
  return deduped;
}

function runSql(psqlBin, databaseUrl, sql) {
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

function runTenantSql(psqlBin, databaseUrl, tenantId, sql) {
  const wrapped = `
BEGIN;
SELECT set_config('app.tenant_id', ${sqlLiteral(tenantId)}, true);
${sql}
COMMIT;
`.trim();

  return runSql(psqlBin, databaseUrl, wrapped);
}

function parseTabJsonRows(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf("\t");
      return tab === -1 ? line : line.slice(tab + 1);
    })
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
}

function truncate(value, max = 500) {
  if (typeof value !== "string") {
    return null;
  }
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function emitError(errorMessage) {
  console.error(
    JSON.stringify({
      event: "mail.receipts.replay.error",
      errorMessage
    })
  );
}

function buildConfirmCommand({
  databaseUrl,
  redisUrl,
  tenantId,
  allowAllTenants,
  receiptId,
  correlationId,
  messageId,
  provider,
  statuses,
  limit,
  sinceMinutes
}) {
  const parts = [
    `DATABASE_URL=${shellValue(databaseUrl)}`,
    `REDIS_URL=${shellValue(redisUrl)}`,
    `PROVIDER=${shellValue(provider)}`,
    `STATUSES=${shellValue(statuses.join(","))}`,
    `LIMIT=${shellValue(limit)}`,
    `SINCE_MINUTES=${shellValue(sinceMinutes)}`
  ];

  if (allowAllTenants) {
    parts.push("ALLOW_ALL_TENANTS=1");
  } else if (tenantId) {
    parts.push(`TENANT_ID=${shellValue(tenantId)}`);
  }

  if (receiptId) {
    parts.push(`RECEIPT_ID=${shellValue(receiptId)}`);
  }
  if (correlationId) {
    parts.push(`CORRELATION_ID=${shellValue(correlationId)}`);
  }
  if (messageId) {
    parts.push(`MESSAGE_ID=${shellValue(messageId)}`);
  }

  parts.push("MAIL_RECEIPTS_REPLAY_CONFIRM=1");
  parts.push("pnpm -w mail:receipts:replay");

  return parts.join(" ");
}

function toReceiptJobId(row) {
  if (typeof row.enqueuedJobId === "string" && row.enqueuedJobId.trim().length > 0) {
    return row.enqueuedJobId;
  }
  return `mail_notification-${row.receiptId}`;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const allowAllTenants = process.env.ALLOW_ALL_TENANTS === "1";
  const tenantId = normalizeOptionalString(process.env.TENANT_ID);
  const receiptId = normalizeOptionalString(process.env.RECEIPT_ID);
  const correlationId = normalizeOptionalString(process.env.CORRELATION_ID);
  const messageId = normalizeOptionalString(process.env.MESSAGE_ID);
  const provider = normalizeOptionalString(process.env.PROVIDER) ?? "gmail";
  const statuses = parseStatuses(process.env.STATUSES ?? "received,failed_transient");
  const limit = toIntInRange(process.env.LIMIT, 50, 1, 200);
  const sinceMinutes = toIntInRange(process.env.SINCE_MINUTES, 1440, 1, 10_080);
  const dryRun = process.env.MAIL_RECEIPTS_REPLAY_CONFIRM !== "1";

  if (!databaseUrl) {
    emitError("DATABASE_URL is required");
    process.exit(1);
  }
  if (!redisUrl) {
    emitError("REDIS_URL is required");
    process.exit(1);
  }
  if (!allowAllTenants && !tenantId) {
    emitError("TENANT_ID is required unless ALLOW_ALL_TENANTS=1");
    process.exit(1);
  }
  if (tenantId && !UUID_PATTERN.test(tenantId)) {
    emitError("TENANT_ID must be a UUID");
    process.exit(1);
  }
  if (receiptId && !UUID_PATTERN.test(receiptId)) {
    emitError("RECEIPT_ID must be a UUID");
    process.exit(1);
  }
  if (!provider) {
    emitError("PROVIDER must not be empty");
    process.exit(1);
  }
  if (statuses === null) {
    emitError(
      "STATUSES must be a comma-separated list from received,enqueued,processing,done,failed_transient,failed_permanent,ignored"
    );
    process.exit(1);
  }
  if (limit === null) {
    emitError("LIMIT must be an integer 1..200");
    process.exit(1);
  }
  if (sinceMinutes === null) {
    emitError("SINCE_MINUTES must be an integer 1..10080");
    process.exit(1);
  }

  let redisUrlHost;
  let dbHost;
  try {
    redisUrlHost = parseHost(redisUrl, "REDIS_URL");
    dbHost = parseHost(databaseUrl, "DATABASE_URL");
  } catch (error) {
    emitError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const psqlBin = resolvePsqlBin();

  const filters = [
    `provider = ${sqlLiteral(provider)}`,
    `received_at >= now() - (${sinceMinutes} * interval '1 minute')`,
    `processing_status = ANY(ARRAY[${statuses.map((status) => sqlLiteral(status)).join(",")}]::text[])`
  ];
  if (tenantId) {
    filters.push(`tenant_id = ${sqlLiteral(tenantId)}::uuid`);
  }
  if (receiptId) {
    filters.push(`id = ${sqlLiteral(receiptId)}::uuid`);
  }
  if (correlationId) {
    filters.push(
      `coalesce(payload->>'correlationId', payload->'attributes'->>'correlationId') = ${sqlLiteral(correlationId)}`
    );
  }
  if (messageId) {
    filters.push(`message_id = ${sqlLiteral(messageId)}`);
  }

  const whereClause = `WHERE ${filters.join(" AND ")}`;

  const listSql = `
SELECT json_build_object(
  'receiptId', id::text,
  'tenantId', tenant_id::text,
  'provider', provider,
  'mailboxId', mailbox_id::text,
  'messageId', message_id,
  'gmailHistoryId', gmail_history_id,
  'correlationId', coalesce(payload->>'correlationId', payload->'attributes'->>'correlationId'),
  'emailAddress', payload->>'emailAddress',
  'status', processing_status,
  'processedAt', processed_at,
  'enqueuedJobId', enqueued_job_id
)::text
FROM mail_notification_receipts
${whereClause}
ORDER BY received_at DESC, id DESC
LIMIT ${limit};
`;

  const runner = tenantId && !allowAllTenants
    ? (sql) => runTenantSql(psqlBin, databaseUrl, tenantId, sql)
    : (sql) => runSql(psqlBin, databaseUrl, sql);

  const queryResult = await runner(listSql);
  if (!queryResult.ok) {
    emitError((queryResult.stderr || "failed querying mail_notification_receipts").trim());
    process.exit(1);
  }

  const rows = parseTabJsonRows(queryResult.stdout).map((line) => JSON.parse(line));

  console.log(
    JSON.stringify({
      event: "mail.receipts.replay.start",
      tenantId: tenantId ?? null,
      allowAllTenants,
      provider,
      statuses,
      limit,
      sinceMinutes,
      dryRun,
      redisUrlHost,
      dbHost
    })
  );

  if (allowAllTenants) {
    console.log(
      JSON.stringify({
        event: "mail.receipts.replay.warning",
        message: "ALLOW_ALL_TENANTS=1 set; tenant filter disabled"
      })
    );
  }

  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  const queue = new Queue(MAIL_NOTIFICATIONS_QUEUE, { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTIONS });

  let enqueued = 0;
  let retried = 0;
  let skipped = 0;

  try {
    for (const row of rows) {
      const jobId = toReceiptJobId(row);
      let action = "skip";
      let reason = null;

      if (TERMINAL_STATUS.has(row.status) || row.processedAt) {
        reason = row.processedAt ? "already_processed" : `status_${row.status}`;
      } else {
        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
          const state = await existingJob.getState();
          if (state === "failed") {
            action = "retry";
            if (!dryRun) {
              await existingJob.retry();
              const updateResult = await runTenantSql(
                psqlBin,
                databaseUrl,
                row.tenantId,
                `
UPDATE mail_notification_receipts
SET
  processing_status = 'enqueued',
  enqueued_at = now(),
  enqueued_job_id = ${sqlLiteral(jobId)},
  last_error = NULL,
  last_error_class = NULL,
  last_error_at = NULL
WHERE tenant_id = ${sqlLiteral(row.tenantId)}::uuid
  AND id = ${sqlLiteral(row.receiptId)}::uuid;
`
              );
              if (!updateResult.ok) {
                throw new Error(`failed updating receipt after retry id=${row.receiptId}`);
              }
            }
            retried += 1;
          } else {
            reason = `job_state_${state}`;
          }
        } else {
          action = "enqueue";
          const rowCorrelationId = normalizeOptionalString(row.correlationId) ?? row.receiptId;
          if (!dryRun) {
            await queue.add(
              MAIL_NOTIFICATION_JOB,
              {
                tenantId: row.tenantId,
                mailboxId: row.mailboxId ?? null,
                provider: row.provider,
                stage: "mail_notification",
                correlationId: rowCorrelationId,
                messageId: row.messageId,
                receiptId: row.receiptId,
                gmailHistoryId: row.gmailHistoryId ?? null,
                emailAddress: row.emailAddress ?? null
              },
              {
                ...DEFAULT_JOB_OPTIONS,
                jobId
              }
            );

            const updateResult = await runTenantSql(
              psqlBin,
              databaseUrl,
              row.tenantId,
              `
UPDATE mail_notification_receipts
SET
  processing_status = 'enqueued',
  enqueued_at = now(),
  enqueued_job_id = ${sqlLiteral(jobId)},
  last_error = NULL,
  last_error_class = NULL,
  last_error_at = NULL
WHERE tenant_id = ${sqlLiteral(row.tenantId)}::uuid
  AND id = ${sqlLiteral(row.receiptId)}::uuid;
`
            );
            if (!updateResult.ok) {
              throw new Error(`failed updating receipt after enqueue id=${row.receiptId}`);
            }
          }
          enqueued += 1;
          if (!normalizeOptionalString(row.correlationId)) {
            reason = "missing_correlation_fallback_receipt_id";
          }
        }
      }

      if (action === "skip") {
        skipped += 1;
      }

      console.log(
        JSON.stringify({
          event: "mail.receipts.replay.match",
          receiptId: row.receiptId,
          tenantId: row.tenantId,
          provider: row.provider,
          messageId: row.messageId,
          correlationId: row.correlationId ?? null,
          status: row.status,
          jobId,
          action,
          reason
        })
      );
    }
  } finally {
    await queue.close();
    await redis.quit();
  }

  const summary = {
    event: "mail.receipts.replay.summary",
    scanned: rows.length,
    matched: rows.length,
    enqueued,
    retried,
    skipped
  };
  console.log(JSON.stringify(summary));

  if (dryRun) {
    const rerun = buildConfirmCommand({
      databaseUrl,
      redisUrl,
      tenantId,
      allowAllTenants,
      receiptId,
      correlationId,
      messageId,
      provider,
      statuses,
      limit,
      sinceMinutes
    });
    console.log(`DRY RUN - no mutations applied. Re-run with confirm: ${rerun}`);
  }

  console.log(
    `OK mail:receipts:replay matched=${rows.length} enqueued=${enqueued} retried=${retried} skipped=${skipped} dryRun=${dryRun ? 1 : 0}`
  );
}

void main().catch((error) => {
  emitError(truncate(error instanceof Error ? error.message : String(error), 500) ?? "unknown error");
  process.exit(1);
});
