import type { CorrelationId, MailJobEnvelope, MailJobType, RunAttempt } from "../pipeline/types";
import type {
  MailProviderName,
  MailboxId,
  ProviderMessageId,
  ProviderThreadId,
  TenantId
} from "../mail/types";

export const QUEUE_NAMES = {
  mailProcessing: "mail_processing"
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const MAIL_JOB_NAMES: Record<MailJobType, MailJobType> = {
  "mail.processInboundMessage": "mail.processInboundMessage"
};

export const DEFAULT_RETRY_POLICY = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delayMs: 1000
  },
  removeOnComplete: true,
  removeOnFail: false
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
