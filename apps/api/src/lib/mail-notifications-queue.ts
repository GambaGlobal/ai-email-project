import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  DEFAULT_BULLMQ_JOB_OPTIONS,
  asCorrelationId,
  newCorrelationId,
  type CorrelationId
} from "@ai-email/shared";

export const MAIL_NOTIFICATIONS_QUEUE = "mail_notifications";
const MAIL_NOTIFICATION_JOB = "mail.notification";

let queue: Queue<MailNotificationJob> | null = null;

export type MailNotificationJob = {
  tenantId: string;
  mailboxId: string | null;
  provider: "gmail";
  stage: "mail_notification";
  correlationId: CorrelationId;
  messageId: string;
  receiptId: string;
  gmailHistoryId: string | null;
  emailAddress: string | null;
};

export type MailNotificationJobInput = Omit<MailNotificationJob, "correlationId"> & {
  correlationId?: CorrelationId | string;
};

function createRedisConnection(): IORedis {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for mail notifications queue");
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

  queue = new Queue<MailNotificationJob>(MAIL_NOTIFICATIONS_QUEUE, {
    connection: createRedisConnection(),
    defaultJobOptions: DEFAULT_BULLMQ_JOB_OPTIONS
  });

  return queue;
}

export function mailNotificationJobId(receiptId: string): string {
  return `mail_notification-${receiptId}`;
}

export async function enqueueMailNotification(job: MailNotificationJobInput, jobId: string): Promise<{
  jobId: string | undefined;
  correlationId: CorrelationId;
  reused: boolean;
}> {
  const notificationQueue = getQueue();
  const correlationId =
    typeof job.correlationId === "string" ? asCorrelationId(job.correlationId) : newCorrelationId();

  const existingJob = await notificationQueue.getJob(jobId);
  if (existingJob) {
    return {
      jobId: existingJob.id?.toString(),
      correlationId,
      reused: true
    };
  }

  const queuedJob = await notificationQueue.add(
    MAIL_NOTIFICATION_JOB,
    {
      ...job,
      correlationId
    },
    {
      jobId
    }
  );

  return {
    jobId: queuedJob.id?.toString(),
    correlationId,
    reused: false
  };
}

export { MAIL_NOTIFICATION_JOB };
