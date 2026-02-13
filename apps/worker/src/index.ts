import { Worker } from "bullmq";
import IORedis from "ioredis";
import { Pool, type PoolClient } from "pg";
import type { CorrelationId } from "@ai-email/shared";
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
    const maxAttempts = job.opts.attempts ?? 1;

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

      const structuredError = toLogError(error);
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify(
          toStructuredLogEvent(baseLogContext, "job.error", {
            startedAt: startedAtIso,
            elapsedMs: Date.now() - startedAt,
            attempt,
            maxAttempts,
            errorCode: structuredError.code,
            errorMessage: structuredError.message,
            errorStack: toSafeStack(structuredError.stack)
          })
        )
      );

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
