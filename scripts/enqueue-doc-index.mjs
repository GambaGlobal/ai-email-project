import { Queue } from "bullmq";
import IORedis from "ioredis";
import { randomUUID } from "node:crypto";
import { DOCS_INDEXING_V1_JOB_NAME, docsVersionIndexingJobId } from "@ai-email/shared";

const redisUrl = process.env.REDIS_URL;
const tenantId = process.env.TENANT_ID;
const docId = process.env.DOC_ID;
const versionId = process.env.VERSION_ID;
const correlationId = process.env.CORRELATION_ID;

function fail(message) {
  console.error(JSON.stringify({ event: "doc.index.enqueue.error", message }));
  process.exit(1);
}

if (!redisUrl) fail("REDIS_URL is required");
if (!tenantId) fail("TENANT_ID is required");
if (!docId) fail("DOC_ID is required");
if (!versionId) fail("VERSION_ID is required");

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

const queue = new Queue("docs_ingestion", { connection });
const jobId = docsVersionIndexingJobId({ tenantId, docId, versionId });

try {
  const existing = await queue.getJob(jobId);
  if (existing) {
    console.log(
      JSON.stringify({
        event: "doc.index.enqueue.reused",
        queue: "docs_ingestion",
        name: DOCS_INDEXING_V1_JOB_NAME,
        jobId
      })
    );
    process.exit(0);
  }

  const job = await queue.add(
    DOCS_INDEXING_V1_JOB_NAME,
    {
      tenantId,
      docId,
      versionId,
      correlationId: correlationId ?? randomUUID()
    },
    { jobId }
  );

  console.log(
    JSON.stringify({
      event: "doc.index.enqueue.ok",
      queue: "docs_ingestion",
      name: DOCS_INDEXING_V1_JOB_NAME,
      jobId: job.id?.toString() ?? jobId
    })
  );
} finally {
  await queue.close();
  await connection.quit();
}
