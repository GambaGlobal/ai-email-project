import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAILBOX_SYNC_QUEUE = "mailbox_sync";
const MAILBOX_SYNC_JOB = "mailbox.sync";
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

function emitError(errorMessage) {
  console.error(
    JSON.stringify({
      event: "mailbox.sync.replay.error",
      errorMessage
    })
  );
}

function buildConfirmCommand({ databaseUrl, redisUrl, tenantId, allowAllTenants, mailboxId, provider, limit }) {
  const parts = [
    `DATABASE_URL=${shellValue(databaseUrl)}`,
    `REDIS_URL=${shellValue(redisUrl)}`,
    `PROVIDER=${shellValue(provider)}`,
    `LIMIT=${shellValue(limit)}`
  ];

  if (allowAllTenants) {
    parts.push("ALLOW_ALL_TENANTS=1");
  } else if (tenantId) {
    parts.push(`TENANT_ID=${shellValue(tenantId)}`);
  }
  if (mailboxId) {
    parts.push(`MAILBOX_ID=${shellValue(mailboxId)}`);
  }

  parts.push("MAILBOX_SYNC_REPLAY_CONFIRM=1");
  parts.push("pnpm -w mailbox:sync:replay");
  return parts.join(" ");
}

function mailboxSyncJobId(provider, mailboxId) {
  return `mailbox_sync-${provider}-${mailboxId}`;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const allowAllTenants = process.env.ALLOW_ALL_TENANTS === "1";
  const tenantId = normalizeOptionalString(process.env.TENANT_ID);
  const mailboxId = normalizeOptionalString(process.env.MAILBOX_ID);
  const provider = normalizeOptionalString(process.env.PROVIDER) ?? "gmail";
  const limit = toIntInRange(process.env.LIMIT, 50, 1, 200);
  const dryRun = process.env.MAILBOX_SYNC_REPLAY_CONFIRM !== "1";

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
  if (mailboxId && !UUID_PATTERN.test(mailboxId)) {
    emitError("MAILBOX_ID must be a UUID when provided");
    process.exit(1);
  }
  if (!provider) {
    emitError("PROVIDER must not be empty");
    process.exit(1);
  }
  if (limit === null) {
    emitError("LIMIT must be an integer 1..200");
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

  const filters = [
    `provider = ${sqlLiteral(provider)}`,
    "pending_max_history_id > last_history_id"
  ];
  if (tenantId) {
    filters.push(`tenant_id = ${sqlLiteral(tenantId)}::uuid`);
  }
  if (mailboxId) {
    filters.push(`mailbox_id = ${sqlLiteral(mailboxId)}::uuid`);
  }

  const listSql = `
SELECT json_build_object(
  'tenantId', tenant_id::text,
  'mailboxId', mailbox_id::text,
  'provider', provider,
  'lastHistoryId', last_history_id::text,
  'pendingMaxHistoryId', pending_max_history_id::text,
  'enqueuedJobId', enqueued_job_id
)::text
FROM mailbox_sync_state
WHERE ${filters.join(" AND ")}
ORDER BY updated_at DESC, mailbox_id ASC
LIMIT ${limit};
`;

  const psqlBin = resolvePsqlBin();
  const runner = tenantId && !allowAllTenants
    ? (sql) => runTenantSql(psqlBin, databaseUrl, tenantId, sql)
    : (sql) => runSql(psqlBin, databaseUrl, sql);

  const queryResult = await runner(listSql);
  if (!queryResult.ok) {
    emitError((queryResult.stderr || "failed querying mailbox_sync_state").trim());
    process.exit(1);
  }

  const rows = parseTabJsonRows(queryResult.stdout).map((line) => JSON.parse(line));

  console.log(
    JSON.stringify({
      event: "mailbox.sync.replay.start",
      tenantId: tenantId ?? null,
      allowAllTenants,
      provider,
      mailboxId,
      limit,
      dryRun,
      redisUrlHost,
      dbHost
    })
  );

  if (allowAllTenants) {
    console.log(
      JSON.stringify({
        event: "mailbox.sync.replay.warning",
        message: "ALLOW_ALL_TENANTS=1 set; tenant filter disabled"
      })
    );
  }

  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  const queue = new Queue(MAILBOX_SYNC_QUEUE, { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTIONS });

  let enqueued = 0;
  let retried = 0;
  let readd = 0;
  let skipped = 0;

  try {
    for (const row of rows) {
      const jobId = mailboxSyncJobId(row.provider, row.mailboxId);
      let action = "skip";
      let reason = null;

      if (!row.mailboxId || !row.tenantId || !row.provider) {
        reason = "missing_identifiers";
      } else {
        const existingJob = await queue.getJob(jobId);

        if (existingJob) {
          const state = await existingJob.getState();
          if (
            state === "active" ||
            state === "waiting" ||
            state === "delayed" ||
            state === "prioritized" ||
            state === "waiting-children"
          ) {
            reason = `job_state_${state}`;
          } else if (state === "failed") {
            action = "retry";
            if (!dryRun) {
              await existingJob.retry();
              const updateResult = await runTenantSql(
                psqlBin,
                databaseUrl,
                row.tenantId,
                `
UPDATE mailbox_sync_state
SET
  enqueued_at = now(),
  enqueued_job_id = ${sqlLiteral(jobId)},
  last_error = NULL,
  updated_at = now()
WHERE tenant_id = ${sqlLiteral(row.tenantId)}::uuid
  AND mailbox_id = ${sqlLiteral(row.mailboxId)}::uuid
  AND provider = ${sqlLiteral(row.provider)};
`
              );
              if (!updateResult.ok) {
                throw new Error(`failed updating mailbox_sync_state after retry mailboxId=${row.mailboxId}`);
              }
            }
            retried += 1;
          } else if (state === "completed") {
            action = "readd";
            if (!dryRun) {
              await existingJob.remove();
              await queue.add(
                MAILBOX_SYNC_JOB,
                {
                  tenantId: row.tenantId,
                  mailboxId: row.mailboxId,
                  provider: row.provider
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
UPDATE mailbox_sync_state
SET
  enqueued_at = now(),
  enqueued_job_id = ${sqlLiteral(jobId)},
  last_error = NULL,
  updated_at = now()
WHERE tenant_id = ${sqlLiteral(row.tenantId)}::uuid
  AND mailbox_id = ${sqlLiteral(row.mailboxId)}::uuid
  AND provider = ${sqlLiteral(row.provider)};
`
              );
              if (!updateResult.ok) {
                throw new Error(`failed updating mailbox_sync_state after readd mailboxId=${row.mailboxId}`);
              }
            }
            readd += 1;
          } else {
            reason = `job_state_${state}`;
          }
        } else {
          action = "enqueue";
          if (!dryRun) {
            await queue.add(
              MAILBOX_SYNC_JOB,
              {
                tenantId: row.tenantId,
                mailboxId: row.mailboxId,
                provider: row.provider
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
UPDATE mailbox_sync_state
SET
  enqueued_at = now(),
  enqueued_job_id = ${sqlLiteral(jobId)},
  last_error = NULL,
  updated_at = now()
WHERE tenant_id = ${sqlLiteral(row.tenantId)}::uuid
  AND mailbox_id = ${sqlLiteral(row.mailboxId)}::uuid
  AND provider = ${sqlLiteral(row.provider)};
`
            );
            if (!updateResult.ok) {
              throw new Error(`failed updating mailbox_sync_state after enqueue mailboxId=${row.mailboxId}`);
            }
          }
          enqueued += 1;
        }
      }

      if (action === "skip") {
        skipped += 1;
      }

      console.log(
        JSON.stringify({
          event: "mailbox.sync.replay.match",
          tenantId: row.tenantId ?? null,
          mailboxId: row.mailboxId ?? null,
          provider: row.provider ?? null,
          lastHistoryId: row.lastHistoryId ?? null,
          pendingMaxHistoryId: row.pendingMaxHistoryId ?? null,
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
    event: "mailbox.sync.replay.summary",
    scanned: rows.length,
    matched: rows.length,
    enqueued,
    retried,
    readd,
    skipped
  };
  console.log(JSON.stringify(summary));

  if (dryRun) {
    const rerun = buildConfirmCommand({
      databaseUrl,
      redisUrl,
      tenantId,
      allowAllTenants,
      mailboxId,
      provider,
      limit
    });
    console.log(`DRY RUN - no mutations applied. Re-run with confirm: ${rerun}`);
  }

  console.log(
    `OK mailbox:sync:replay matched=${rows.length} enqueued=${enqueued} retried=${retried} readd=${readd} skipped=${skipped} dryRun=${dryRun ? 1 : 0}`
  );
}

void main().catch((error) => {
  emitError(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
