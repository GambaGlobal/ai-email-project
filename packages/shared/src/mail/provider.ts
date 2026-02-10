import type {
  CanonicalDraft,
  CanonicalMessage,
  CanonicalThread,
  MailEvent,
  MailProviderName,
  MailboxId,
  TenantId,
  ProviderMessageId,
  ProviderThreadId
} from "./types";

export type MailProviderContext = {
  tenantId: TenantId;
  mailboxId: MailboxId;
};

export type MailProviderWatchState = {
  provider: MailProviderName;
  cursor: string;
  startedAt: string;
};

export type MailProvider = {
  name: MailProviderName;

  // Notification lifecycle
  startWatch(context: MailProviderContext): Promise<MailProviderWatchState>;
  stopWatch(context: MailProviderContext): Promise<void>;
  validateNotification(payload: unknown): Promise<boolean>;
  translateNotification(
    payload: unknown,
    context: MailProviderContext
  ): Promise<MailEvent[]>;
  listRecent(
    context: MailProviderContext,
    cursor?: string
  ): Promise<MailEvent[]>;

  // Data access
  fetchMessage(
    context: MailProviderContext,
    providerMessageId: ProviderMessageId
  ): Promise<CanonicalMessage>;
  fetchThread(
    context: MailProviderContext,
    providerThreadId: ProviderThreadId
  ): Promise<CanonicalThread & { messages: CanonicalMessage[] }>;

  // Draft operations
  createDraftInThread(
    context: MailProviderContext,
    providerThreadId: ProviderThreadId,
    draft: Omit<CanonicalDraft, "providerDraftId">
  ): Promise<CanonicalDraft>;
  updateDraft?(
    context: MailProviderContext,
    providerDraftId: string,
    draft: Partial<CanonicalDraft>
  ): Promise<CanonicalDraft>;
  applyLabel?(
    context: MailProviderContext,
    providerMessageId: ProviderMessageId,
    label: string
  ): Promise<void>;
};
