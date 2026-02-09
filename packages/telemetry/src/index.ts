import type { MailboxId, TenantId } from "@ai-email/core";

export type TelemetryEventName =
  | "tenant_created"
  | "mailbox_connect_started"
  | "mailbox_connect_succeeded"
  | "mailbox_connect_failed"
  | "email_received"
  | "draft_generated"
  | "draft_generation_failed"
  | "sensitive_flagged";

export type TelemetryEvent = {
  name: TelemetryEventName;
  tenantId: TenantId;
  mailboxId?: MailboxId;
  ts: string;
  props?: Record<string, unknown>;
};

export interface TelemetryClient {
  track(event: TelemetryEvent): void | Promise<void>;
}
