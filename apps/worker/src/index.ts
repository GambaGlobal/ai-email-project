import { Worker } from "bullmq";
import IORedis from "ioredis";
import { Pool, type PoolClient } from "pg";

type DocsIngestionJob = {
  tenantId: string;
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

async function withTenantClient<T>(tenantId: string, callback: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.tenant_id = $1", [tenantId]);
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
    const { tenantId, docId } = job.data;

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

ingestionWorker.on("failed", (job, error) => {
  // eslint-disable-next-line no-console
  console.error(`doc ingestion job failed ${job?.id ?? "unknown"}`, error);
});
