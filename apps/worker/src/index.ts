import { UnrecoverableError, Worker } from "bullmq";
import IORedis from "ioredis";
import { Pool, type PoolClient } from "pg";
import {
  DEFAULT_JOB_ATTEMPTS,
  ErrorClass,
  KILL_SWITCH_DOCS_INGESTION,
  classifyError,
  isGlobalDocsIngestionDisabled,
  type CorrelationId
} from "@ai-email/shared";
import { toLogError, toStructuredLogContext, toStructuredLogEvent } from "./logging.js";

type DocsIngestionJob = {
  tenantId: string;
  mailboxId?: string;
  provider?: string;
  stage?: string;
  correlationId: CorrelationId;
  causationId?: string;
  threadId?: string;
  messageId?: string;
  gmailHistoryId?: string;
  docId: string;
  bucket: string;
  storageKey: string;
  category: string;
};

const workerName = process.env.WORKER_NAME ?? "worker";
const docsQueueName = "docs_ingestion";

if (!process.env.REDIS_URL) {
  // eslint-disable-next-line no-console
  console.log("redis not configured, skipping queue init");
  // eslint-disable-next-line no-console
  console.log(`worker ready (${workerName}) at ${new Date().toISOString()}`);
  process.exit(0);
}

const redisConnection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

const dbPool = new Pool({ connectionString: process.env.DATABASE_URL });

function toSafeStack(stack: string | undefined): string | undefined {
  if (!stack) {
    return undefined;
  }
  return stack.split("\n").slice(0, 6).join("\n");
}

function truncateText(value: string | undefined, max: number): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > max ? value.slice(0, max) : value;
}

async function withTenantClient<T>(tenantId: string, callback: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getTenantKillSwitchState(tenantId: string, key: string) {
  return withTenantClient(tenantId, async (client) => {
    const result = await client.query(
      `
        SELECT is_enabled, reason
        FROM tenant_kill_switches
        WHERE tenant_id = $1
          AND key = $2
      `,
      [tenantId, key]
    );

    const row = result.rows[0] as { is_enabled?: unknown; reason?: unknown } | undefined;
    return {
      isEnabled: row?.is_enabled === true,
      reason: typeof row?.reason === "string" ? row.reason : null
    };
  });
}

const ingestionWorker = new Worker<DocsIngestionJob>(
  docsQueueName,
  async (job) => {
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    const { tenantId, docId } = job.data;
    const correlationId = job.data.correlationId;
    const baseLogContext = toStructuredLogContext({
      tenantId: job.data.tenantId,
      mailboxId: job.data.mailboxId,
      provider: job.data.provider ?? "other",
      stage: job.data.stage ?? "doc_ingestion",
      queueName: job.queueName,
      jobId: job.id?.toString(),
      correlationId,
      causationId: job.data.causationId,
      threadId: job.data.threadId,
      messageId: job.data.messageId,
      gmailHistoryId: job.data.gmailHistoryId
    });
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? DEFAULT_JOB_ATTEMPTS;

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        toStructuredLogEvent(baseLogContext, "job.start", {
          startedAt: startedAtIso,
          attempt,
          maxAttempts
        })
      )
    );

    if (isGlobalDocsIngestionDisabled(process.env)) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "job.ignored",
          reason: "kill_switch_global",
          key: KILL_SWITCH_DOCS_INGESTION,
          correlationId,
          tenantId,
          queueName: job.queueName,
          jobId: job.id?.toString(),
          attempt,
          maxAttempts
        })
      );
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          toStructuredLogEvent(baseLogContext, "job.done", {
            startedAt: startedAtIso,
            elapsedMs: Date.now() - startedAt,
            attempt,
            maxAttempts
          })
        )
      );
      return;
    }

    const tenantKillSwitch = await getTenantKillSwitchState(tenantId, KILL_SWITCH_DOCS_INGESTION);
    if (tenantKillSwitch.isEnabled) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "job.ignored",
          reason: "kill_switch_tenant",
          key: KILL_SWITCH_DOCS_INGESTION,
          killSwitchReason: tenantKillSwitch.reason,
          correlationId,
          tenantId,
          queueName: job.queueName,
          jobId: job.id?.toString(),
          attempt,
          maxAttempts
        })
      );
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          toStructuredLogEvent(baseLogContext, "job.done", {
            startedAt: startedAtIso,
            elapsedMs: Date.now() - startedAt,
            attempt,
            maxAttempts
          })
        )
      );
      return;
    }

    await withTenantClient(tenantId, async (client) => {
      await client.query(
        `
          UPDATE docs
          SET
            status = 'indexing',
            error_message = NULL,
            updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
        `,
        [tenantId, docId]
      );
    });

    try {
      // Phase 9.7 minimal ingestion hook:
      // real parse/chunk/embed/index pipeline wiring remains in later steps.
      await new Promise((resolve) => setTimeout(resolve, 700));

      await withTenantClient(tenantId, async (client) => {
        await client.query(
          `
            UPDATE docs
            SET
              status = 'ready',
              error_message = NULL,
              indexed_at = now(),
              updated_at = now()
            WHERE tenant_id = $1
              AND id = $2
          `,
          [tenantId, docId]
        );
      });

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          toStructuredLogEvent(baseLogContext, "job.done", {
            startedAt: startedAtIso,
            elapsedMs: Date.now() - startedAt,
            attempt,
            maxAttempts
          })
        )
      );
    } catch (error) {
      const classifiedError = classifyError(error);
      const errorClass =
        classifiedError.class === ErrorClass.TRANSIENT ? ErrorClass.TRANSIENT : ErrorClass.PERMANENT;
      const structuredError = toLogError(error);
      const truncatedStack = truncateText(toSafeStack(structuredError.stack), 4000);
      const stage = job.data.stage ?? "doc_ingestion";

      try {
        await withTenantClient(tenantId, async (client) => {
          await client.query(
            `
              INSERT INTO doc_ingestion_failures (
                tenant_id,
                correlation_id,
                job_id,
                stage,
                error_class,
                error_code,
                error_message,
                error_stack,
                attempt,
                max_attempts
              )
              VALUES ($1, $2, $3, $4, $5, $6, LEFT($7, 2000), $8, $9, $10)
            `,
            [
              tenantId,
              correlationId,
              job.id?.toString() ?? "unknown",
              stage,
              errorClass,
              structuredError.code ?? classifiedError.code ?? null,
              structuredError.message,
              truncatedStack ?? null,
              attempt,
              maxAttempts
            ]
          );
        });
      } catch (recordError) {
        const recordMessage = recordError instanceof Error ? recordError.message : String(recordError);
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            event: "failure.record_error",
            tenantId,
            correlationId,
            queueName: job.queueName,
            jobId: job.id?.toString(),
            errorMessage: recordMessage
          })
        );
      }

      await withTenantClient(tenantId, async (client) => {
        await client.query(
          `
            UPDATE docs
            SET
              status = 'failed',
              error_message = LEFT($3, 500),
              updated_at = now()
            WHERE tenant_id = $1
              AND id = $2
          `,
          [tenantId, docId, error instanceof Error ? error.message : "Ingestion failed"]
        );
      });

      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify(
          toStructuredLogEvent(baseLogContext, "job.error", {
            startedAt: startedAtIso,
            elapsedMs: Date.now() - startedAt,
            attempt,
            maxAttempts,
            errorClass,
            errorCode: structuredError.code ?? classifiedError.code,
            errorMessage: structuredError.message,
            errorStack: truncatedStack
          })
        )
      );

      if (errorClass === ErrorClass.PERMANENT) {
        throw new UnrecoverableError(structuredError.message);
      }

      throw error;
    }
  },
  {
    connection: redisConnection
  }
);

ingestionWorker.on("ready", () => {
  // eslint-disable-next-line no-console
  console.log(`worker ready (${workerName}) at ${new Date().toISOString()}`);
});
