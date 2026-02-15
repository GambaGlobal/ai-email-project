import { Queue } from "bullmq";
import IORedis from "ioredis";
import { DEFAULT_BULLMQ_JOB_OPTIONS } from "@ai-email/shared";

export const MAILBOX_SYNC_QUEUE = "mailbox_sync";
const MAILBOX_SYNC_JOB = "mailbox.sync";

let queue: Queue<MailboxSyncJob> | null = null;

export type MailboxSyncJob = {
  tenantId: string;
  mailboxId: string;
  provider: "gmail";
};

function createRedisConnection(): IORedis {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for mailbox sync queue");
  }

  return new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
}

function getQueue() {
  if (queue) {
    return queue;
  }

  queue = new Queue<MailboxSyncJob>(MAILBOX_SYNC_QUEUE, {
    connection: createRedisConnection(),
    defaultJobOptions: DEFAULT_BULLMQ_JOB_OPTIONS
  });

  return queue;
}

export function mailboxSyncJobId(provider: string, mailboxId: string): string {
  return `mailbox_sync-${provider}-${mailboxId}`;
}

export async function enqueueMailboxSync(job: MailboxSyncJob, jobId: string): Promise<{
  jobId: string | undefined;
  reused: boolean;
}> {
  const syncQueue = getQueue();

  const existingJob = await syncQueue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (
      state === "active" ||
      state === "waiting" ||
      state === "delayed" ||
      state === "prioritized" ||
      state === "waiting-children"
    ) {
      return {
        jobId: existingJob.id?.toString(),
        reused: true
      };
    }

    try {
      await syncQueue.remove(jobId);
    } catch {
      return {
        jobId: existingJob.id?.toString(),
        reused: true
      };
    }
  }

  try {
    const queuedJob = await syncQueue.add(MAILBOX_SYNC_JOB, job, { jobId });
    return {
      jobId: queuedJob.id?.toString(),
      reused: false
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/job\s+.*already\s+exists/i.test(message)) {
      const existing = await syncQueue.getJob(jobId);
      return {
        jobId: existing?.id?.toString() ?? jobId,
        reused: true
      };
    }
    throw error;
  }
}

export { MAILBOX_SYNC_JOB };
