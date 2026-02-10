import type {
  MailProviderName,
  MailboxId,
  ProviderMessageId,
  ProviderThreadId,
  TenantId
} from "../mail/types";

export type RunId = string & { readonly __brand: "RunId" };
export type CorrelationId = string & { readonly __brand: "CorrelationId" };
export type RunAttempt = number & { readonly __brand: "RunAttempt" };

export type RunKey = {
  tenantId: TenantId;
  mailboxId: MailboxId;
  provider: MailProviderName;
  providerMessageId: ProviderMessageId;
  attempt: RunAttempt;
};

export type RunContext = RunKey & {
  runId?: RunId;
  correlationId?: CorrelationId;
  enqueuedAt?: string;
};

export type MailJobType = "mail.processInboundMessage";

export type MailJobEnvelope = {
  type: MailJobType;
  tenantId: TenantId;
  mailboxId: MailboxId;
  provider: MailProviderName;
  providerMessageId: ProviderMessageId;
  providerThreadId?: ProviderThreadId;
  attempt: RunAttempt;
  providerCursor?: string;
  correlationId?: CorrelationId;
  enqueuedAt: string;
};

export type AuditStage =
  | "notification_received"
  | "job_enqueued"
  | "processing_started"
  | "provider_fetch_complete"
  | "retrieval_complete"
  | "guardrails_complete"
  | "ai_complete"
  | "draft_created"
  | "sensitive_flagged"
  | "processing_completed"
  | "processing_failed";

export type AuditEvent = {
  tenantId: TenantId;
  mailboxId: MailboxId;
  runId?: RunId;
  correlationId?: CorrelationId;
  stage: AuditStage;
  occurredAt: string;
  providerMessageId?: ProviderMessageId;
  providerThreadId?: ProviderThreadId;
  error?: PipelineError;
  payload?: Record<string, unknown>;
};

export type ErrorCategory =
  | "provider_transient"
  | "provider_permanent"
  | "rate_limited"
  | "auth_revoked"
  | "validation"
  | "ai_timeout"
  | "ai_failure"
  | "retrieval_empty"
  | "unknown";

export type PipelineError = {
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};
