export type MailProviderName = "gmail" | "outlook";

export type TenantId = string & { readonly __brand: "TenantId" };
export type MailboxId = string & { readonly __brand: "MailboxId" };

export type ThreadId = string & { readonly __brand: "ThreadId" };
export type MessageId = string & { readonly __brand: "MessageId" };
export type DraftId = string & { readonly __brand: "DraftId" };
export type LabelId = string & { readonly __brand: "LabelId" };
export type Cursor = string & { readonly __brand: "Cursor" };
export type DraftWriteFingerprint = string & {
  readonly __brand: "DraftWriteFingerprint";
};

export type MailAddress = {
  name?: string;
  email: string;
};

export type Participants = {
  from: MailAddress;
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  replyTo?: MailAddress[];
};

export type MailBody = {
  text: string;
  html?: string;
};

export type MailAttachmentMeta = {
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  attachmentId?: string;
};

export type MailMessage = {
  id: MessageId;
  threadId: ThreadId;
  internalDateMs: number;
  subject?: string;
  participants: Participants;
  body?: MailBody;
  snippet?: string;
  headers?: Record<string, string>;
  attachments?: MailAttachmentMeta[];
  labelIds?: LabelId[];
};

export type MailThread = {
  id: ThreadId;
  messages: MailMessage[];
  labelIds?: LabelId[];
};

export type CopilotDraftMarker = {
  draftKey: string;
  version: number;
};

export const X_INBOX_COPILOT_DRAFT_KEY = "X-Inbox-Copilot-Draft-Key";
export const X_INBOX_COPILOT_MARKER_VERSION = "X-Inbox-Copilot-Marker-Version";

// Legacy aliases retained to keep downstream Phase 2 contracts compiling.
export type ProviderMailboxId = string & { readonly __brand: "ProviderMailboxId" };
export type ProviderThreadId = ThreadId;
export type ProviderMessageId = MessageId;
export type ProviderDraftId = DraftId;
export type EmailAddress = {
  name?: string;
  address: string;
};
export type AttachmentMeta = {
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  providerAttachmentId?: string;
};
export type CanonicalMailbox = {
  provider: MailProviderName;
  providerMailboxId: ProviderMailboxId;
  emailAddress: string;
};
export type CanonicalThread = {
  provider: MailProviderName;
  providerThreadId: ProviderThreadId;
  mailboxId: MailboxId;
  messageIds: ProviderMessageId[];
};
export type CanonicalMessage = {
  provider: MailProviderName;
  providerMessageId: ProviderMessageId;
  providerThreadId?: ProviderThreadId;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  subject: string;
  sentAt: string;
  receivedAt?: string;
  textBody: string;
  htmlBody?: string;
  snippet?: string;
  attachments?: AttachmentMeta[];
};
export type CanonicalDraft = {
  provider: MailProviderName;
  providerDraftId?: ProviderDraftId;
  providerThreadId: ProviderThreadId;
  bodyText: string;
  bodyHtml?: string;
  createdAt?: string;
};
export type MailEvent = {
  type: "mail.message.received";
  tenantId: TenantId;
  mailboxId: MailboxId;
  provider: MailProviderName;
  providerMessageId: ProviderMessageId;
  providerThreadId?: ProviderThreadId;
  occurredAt: string;
  providerCursor?: string;
};
