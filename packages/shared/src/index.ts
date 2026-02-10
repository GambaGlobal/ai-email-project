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
