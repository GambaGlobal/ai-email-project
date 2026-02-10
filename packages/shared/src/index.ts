export type {
  AttachmentMeta,
  CanonicalDraft,
  CanonicalMailbox,
  CanonicalMessage,
  CanonicalThread,
  EmailAddress,
  MailEvent,
  MailProviderName,
  MailboxId,
  ProviderDraftId,
  ProviderMailboxId,
  ProviderMessageId,
  ProviderThreadId,
  TenantId
} from "./mail/types";

export type {
  MailProvider,
  MailProviderContext,
  MailProviderWatchState
} from "./mail/provider";

export type {
  MailProviderFactory,
  MailProviderRegistry
} from "./mail/registry";

export type {
  AuditEvent,
  AuditStage,
  CorrelationId,
  ErrorCategory,
  MailJobEnvelope,
  MailJobType,
  PipelineError,
  RunAttempt,
  RunContext,
  RunId,
  RunKey
} from "./pipeline/types";

export {
  DEFAULT_RETRY_POLICY,
  MAIL_JOB_NAMES,
  QUEUE_NAMES,
  buildMailJobEnvelope
} from "./queue/types";

export type {
  MailJobInput,
  QueueName
} from "./queue/types";
