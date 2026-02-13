import type { CorrelationId, MailJobEnvelope, MailJobType, RunAttempt } from "../pipeline/types";
import type {
  MailProviderName,
  MailboxId,
  ProviderMessageId,
  ProviderThreadId,
  TenantId
} from "../mail/types";
import {
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BULLMQ_JOB_OPTIONS,
  DEFAULT_JOB_ATTEMPTS
} from "../reliability/retry-policy";

export const QUEUE_NAMES = {
  mailProcessing: "mail_processing",
  notificationIngest: "q.notification_ingest",
  historySync: "q.history_sync",
  threadFetch: "q.thread_fetch",
  classify: "q.classify",
  draftGenerate: "q.draft_generate",
  draftWriteback: "q.draft_writeback",
  backfillReplay: "q.backfill_replay"
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type MailProvider = MailProviderName;

export type JobStage =
  | "notification_ingest"
  | "history_sync"
  | "thread_fetch"
  | "classify"
  | "draft_generate"
  | "draft_writeback"
  | "backfill_replay";

export type StageToQueue = {
  notification_ingest: (typeof QUEUE_NAMES)["notificationIngest"];
  history_sync: (typeof QUEUE_NAMES)["historySync"];
  thread_fetch: (typeof QUEUE_NAMES)["threadFetch"];
  classify: (typeof QUEUE_NAMES)["classify"];
  draft_generate: (typeof QUEUE_NAMES)["draftGenerate"];
  draft_writeback: (typeof QUEUE_NAMES)["draftWriteback"];
  backfill_replay: (typeof QUEUE_NAMES)["backfillReplay"];
};

export const STAGE_TO_QUEUE: StageToQueue = {
  notification_ingest: QUEUE_NAMES.notificationIngest,
  history_sync: QUEUE_NAMES.historySync,
  thread_fetch: QUEUE_NAMES.threadFetch,
  classify: QUEUE_NAMES.classify,
  draft_generate: QUEUE_NAMES.draftGenerate,
  draft_writeback: QUEUE_NAMES.draftWriteback,
  backfill_replay: QUEUE_NAMES.backfillReplay
};

export const queueNameForStage = <TStage extends JobStage>(stage: TStage): StageToQueue[TStage] =>
  STAGE_TO_QUEUE[stage];

export const MAIL_JOB_NAMES: Record<MailJobType, MailJobType> = {
  "mail.processInboundMessage": "mail.processInboundMessage"
};

export const DEFAULT_RETRY_POLICY = {
  attempts: DEFAULT_JOB_ATTEMPTS,
  backoff: {
    type: "exponential",
    delayMs: DEFAULT_BACKOFF_BASE_MS
  },
  removeOnComplete: DEFAULT_BULLMQ_JOB_OPTIONS.removeOnComplete,
  removeOnFail: DEFAULT_BULLMQ_JOB_OPTIONS.removeOnFail
} as const;

export type MailJobInput = {
  tenantId: TenantId;
  mailboxId: MailboxId;
  provider: MailProviderName;
  providerMessageId: ProviderMessageId;
  providerThreadId?: ProviderThreadId;
  attempt: RunAttempt;
  providerCursor?: string;
  correlationId?: CorrelationId;
};

export type JobMeta = {
  schemaVersion: 1;
  stage: JobStage;
  provider: MailProvider;
  tenantId: TenantId;
  mailboxId: MailboxId;
  threadId?: ProviderThreadId;
  messageId?: ProviderMessageId;
  gmailHistoryId?: string;
  correlationId: CorrelationId;
  causationId?: string;
  receivedAt: string;
};

export type NotificationIngestMeta = {
  notificationId?: string;
  subscriptionId?: string;
  publishedAt?: string;
};

export type NotificationIngestPayload =
  | (NotificationIngestMeta & {
      providerCursor: string;
      gmailHistoryId?: string;
    })
  | (NotificationIngestMeta & {
      gmailHistoryId: string;
      providerCursor?: string;
    });

export type HistorySyncPayload = {
  startCursor?: string;
  endCursor?: string;
  startHistoryId?: string;
  endHistoryId?: string;
  reason?: "notification" | "scheduled" | "manual_replay";
};

export type ThreadFetchPayload = {
  threadId: string;
  messageId?: string;
  includeAttachmentMetadata?: boolean;
};

export type ClassifyPayload = {
  threadId: string;
  messageId?: string;
};

export type DraftGeneratePayload = {
  threadId: string;
  messageIds?: string[];
  contextRefId?: string;
};

export type DraftWritebackPayload = {
  threadId: string;
  draftRefId: string;
  messageId?: string;
};

export type BackfillReplayPayload = {
  startAt: string;
  endAt: string;
  threadId?: string;
  messageId?: string;
  reason?: string;
};

export type StagePayloadMap = {
  notification_ingest: NotificationIngestPayload;
  history_sync: HistorySyncPayload;
  thread_fetch: ThreadFetchPayload;
  classify: ClassifyPayload;
  draft_generate: DraftGeneratePayload;
  draft_writeback: DraftWritebackPayload;
  backfill_replay: BackfillReplayPayload;
};

export type JobEnvelope<TStage extends JobStage = JobStage> = {
  meta: JobMeta & {
    stage: TStage;
  };
  payload: StagePayloadMap[TStage];
};

export const buildMailJobEnvelope = (
  type: MailJobType,
  payload: MailJobInput
): MailJobEnvelope => ({
  type,
  tenantId: payload.tenantId,
  mailboxId: payload.mailboxId,
  provider: payload.provider,
  providerMessageId: payload.providerMessageId,
  providerThreadId: payload.providerThreadId,
  attempt: payload.attempt,
  providerCursor: payload.providerCursor,
  correlationId: payload.correlationId,
  enqueuedAt: new Date().toISOString()
});
