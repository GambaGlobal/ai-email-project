export type MailProviderName = "gmail" | "outlook";

export type TenantId = string & { readonly __brand: "TenantId" };
export type MailboxId = string & { readonly __brand: "MailboxId" };

export type ProviderMailboxId = string & { readonly __brand: "ProviderMailboxId" };
export type ProviderThreadId = string & { readonly __brand: "ProviderThreadId" };
export type ProviderMessageId = string & { readonly __brand: "ProviderMessageId" };
export type ProviderDraftId = string & { readonly __brand: "ProviderDraftId" };

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
