import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  DEFAULT_BULLMQ_JOB_OPTIONS,
  DOCS_INDEXING_V1_JOB_NAME,
  DOCS_INGESTION_V1_JOB_NAME,
  asCorrelationId,
  docsVersionIndexingJobId,
  docsIngestionJobId,
  docsVersionIngestionJobId,
  newCorrelationId,
  type CorrelationId
} from "@ai-email/shared";

const DOCS_INGESTION_QUEUE = "docs_ingestion";
const DOCS_INGESTION_JOB = "docs.ingest";

let queue: Queue<DocsIngestionJob | DocVersionIngestionJob | DocVersionIndexingJob> | null = null;

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

export type DocVersionIngestionJob = {
  tenantId: string;
  docId: string;
  versionId: string;
  correlationId: CorrelationId;
};

export type DocVersionIngestionJobInput = Omit<DocVersionIngestionJob, "correlationId"> & {
  correlationId?: CorrelationId | string;
};

export type DocVersionIndexingJob = {
  tenantId: string;
  docId: string;
  versionId: string;
  correlationId: CorrelationId;
};

export type DocVersionIndexingJobInput = Omit<DocVersionIndexingJob, "correlationId"> & {
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

function getQueue(): Queue<DocsIngestionJob | DocVersionIngestionJob | DocVersionIndexingJob> {
  if (queue) {
    return queue;
  }

  queue = new Queue<DocsIngestionJob | DocVersionIngestionJob | DocVersionIndexingJob>(DOCS_INGESTION_QUEUE, {
    connection: createRedisConnection(),
    defaultJobOptions: DEFAULT_BULLMQ_JOB_OPTIONS
  });

  return queue as Queue<DocsIngestionJob | DocVersionIngestionJob | DocVersionIndexingJob>;
}

export async function enqueueDocIngestion(job: DocsIngestionJobInput): Promise<{
  jobId: string | undefined;
  correlationId: CorrelationId;
  reused: boolean;
}> {
  const ingestionQueue = getQueue();
  const correlationId =
    typeof job.correlationId === "string" ? asCorrelationId(job.correlationId) : newCorrelationId();
  const deterministicJobId = docsIngestionJobId(job.docId);
  const existingJob = await ingestionQueue.getJob(deterministicJobId);
  if (existingJob) {
    return {
      jobId: existingJob.id?.toString(),
      correlationId,
      reused: true
    };
  }

  const jobWithCorrelation: DocsIngestionJob = {
    ...job,
    correlationId
  };

  const queuedJob = await ingestionQueue.add(DOCS_INGESTION_JOB, jobWithCorrelation, {
    jobId: deterministicJobId
  });

  return {
    jobId: queuedJob.id?.toString(),
    correlationId,
    reused: false
  };
}

export async function enqueueDocVersionIngestion(job: DocVersionIngestionJobInput): Promise<{
  jobId: string | undefined;
  correlationId: CorrelationId;
  reused: boolean;
}> {
  const ingestionQueue = getQueue();
  const correlationId =
    typeof job.correlationId === "string" ? asCorrelationId(job.correlationId) : newCorrelationId();
  const deterministicJobId = docsVersionIngestionJobId({
    tenantId: job.tenantId,
    docId: job.docId,
    versionId: job.versionId
  });
  const existingJob = await ingestionQueue.getJob(deterministicJobId);
  if (existingJob) {
    return {
      jobId: existingJob.id?.toString(),
      correlationId,
      reused: true
    };
  }

  const queuedJob = await ingestionQueue.add(
    DOCS_INGESTION_V1_JOB_NAME,
    {
      tenantId: job.tenantId,
      docId: job.docId,
      versionId: job.versionId,
      correlationId
    } satisfies DocVersionIngestionJob,
    {
      jobId: deterministicJobId
    }
  );

  return {
    jobId: queuedJob.id?.toString(),
    correlationId,
    reused: false
  };
}

export async function enqueueDocVersionIndexing(job: DocVersionIndexingJobInput): Promise<{
  jobId: string | undefined;
  correlationId: CorrelationId;
  reused: boolean;
}> {
  const ingestionQueue = getQueue();
  const correlationId =
    typeof job.correlationId === "string" ? asCorrelationId(job.correlationId) : newCorrelationId();
  const deterministicJobId = docsVersionIndexingJobId({
    tenantId: job.tenantId,
    docId: job.docId,
    versionId: job.versionId
  });
  const existingJob = await ingestionQueue.getJob(deterministicJobId);
  if (existingJob) {
    return {
      jobId: existingJob.id?.toString(),
      correlationId,
      reused: true
    };
  }

  const queuedJob = await ingestionQueue.add(
    DOCS_INDEXING_V1_JOB_NAME,
    {
      tenantId: job.tenantId,
      docId: job.docId,
      versionId: job.versionId,
      correlationId
    } satisfies DocVersionIndexingJob,
    {
      jobId: deterministicJobId
    }
  );

  return {
    jobId: queuedJob.id?.toString(),
    correlationId,
    reused: false
  };
}

export { DOCS_INGESTION_JOB, DOCS_INGESTION_QUEUE };
