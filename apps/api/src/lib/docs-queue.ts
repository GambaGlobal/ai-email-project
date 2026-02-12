import { Queue } from "bullmq";
import IORedis from "ioredis";

const DOCS_INGESTION_QUEUE = "docs_ingestion";
const DOCS_INGESTION_JOB = "docs.ingest";

let queue: Queue<DocsIngestionJob> | null = null;

export type DocsIngestionJob = {
  tenantId: string;
  docId: string;
  bucket: string;
  storageKey: string;
  category: string;
};

function createRedisConnection(): IORedis {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is required for docs ingestion queue");
  }

  return new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
}

function getQueue(): Queue<DocsIngestionJob> {
  if (queue) {
    return queue;
  }

  queue = new Queue<DocsIngestionJob>(DOCS_INGESTION_QUEUE, {
    connection: createRedisConnection()
  });

  return queue;
}

export async function enqueueDocIngestion(job: DocsIngestionJob): Promise<void> {
  const ingestionQueue = getQueue();

  await ingestionQueue.add(DOCS_INGESTION_JOB, job, {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000
    }
  });
}

export { DOCS_INGESTION_JOB, DOCS_INGESTION_QUEUE };
