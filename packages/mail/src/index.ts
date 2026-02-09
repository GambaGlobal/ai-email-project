import type { ISODateTime, MailboxId, TenantId } from "@ai-email/core";

export type MailProviderName = "gmail" | "outlook";

export type MailMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: ISODateTime;
};

export type MailThread = {
  id: string;
  messages: MailMessage[];
};

export type CreateDraftInput = {
  tenantId: TenantId;
  mailboxId: MailboxId;
  threadId: string;
  body: string;
};

export interface MailProvider {
  readonly name: MailProviderName;
  listThreads(tenantId: TenantId, mailboxId: MailboxId): Promise<MailThread[]>;
  getThread(tenantId: TenantId, mailboxId: MailboxId, threadId: string): Promise<MailThread>;
  createDraftReply(input: CreateDraftInput): Promise<{ draftId: string }>;
}
