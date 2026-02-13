import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  DEFAULT_BULLMQ_JOB_OPTIONS,
  asCorrelationId,
  newCorrelationId,
  type CorrelationId
} from "@ai-email/shared";

const DOCS_INGESTION_QUEUE = "docs_ingestion";
const DOCS_INGESTION_JOB = "docs.ingest";

let queue: Queue<DocsIngestionJob> | null = null;

export type DocsIngestionJob = {
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

export type DocsIngestionJobInput = Omit<DocsIngestionJob, "correlationId"> & {
  correlationId?: CorrelationId | string;
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
    connection: createRedisConnection(),
    defaultJobOptions: DEFAULT_BULLMQ_JOB_OPTIONS
  });

  return queue as Queue<DocsIngestionJob>;
}

export async function enqueueDocIngestion(job: DocsIngestionJobInput): Promise<{
  jobId: string | undefined;
  correlationId: CorrelationId;
}> {
  const ingestionQueue = getQueue();
  const correlationId =
    typeof job.correlationId === "string" ? asCorrelationId(job.correlationId) : newCorrelationId();
  const jobWithCorrelation: DocsIngestionJob = {
    ...job,
    correlationId
  };

  const queuedJob = await ingestionQueue.add(DOCS_INGESTION_JOB, jobWithCorrelation);

  return {
    jobId: queuedJob.id?.toString(),
    correlationId
  };
}

export { DOCS_INGESTION_JOB, DOCS_INGESTION_QUEUE };
