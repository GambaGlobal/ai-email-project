import type { CorrelationId } from "../pipeline/types";

export type TelemetryEventName =
  | "mail.ingestion.plan_built"
  | "mail.thread.fetched"
  | "mail.triage.decided"
  | "mail.draft.upsert_attempted"
  | "mail.draft.upsert_result"
  | "mail.label.applied"
  | "mail.blocked_user_edited"
  | "mail.failure.classified"
  | "mail.resync.decided";

export interface TelemetryContext {
  tenantId: string;
  mailboxId: string;
  provider: "gmail" | "outlook" | "other";
  correlationId?: CorrelationId;
  threadId?: string;
  messageId?: string;
  draftId?: string;
  draftKey?: string;
  idempotencyKey?: string;
}

export type TelemetryEvent =
  | {
      name: "mail.ingestion.plan_built";
      props: {
        messageCount: number;
        threadCount: number;
        needsFullSync?: boolean;
      };
    }
  | {
      name: "mail.thread.fetched";
      props: {
        includeBody: boolean;
        messageCount: number;
      };
    }
  | {
      name: "mail.triage.decided";
      props: {
        action: "draft" | "needs_review" | "ignore";
        reason: string;
      };
    }
  | {
      name: "mail.draft.upsert_attempted";
      props: {
        kind: "copilot_reply";
        hasExistingDraft: boolean;
        expectedPreviousFingerprint?: boolean;
      };
    }
  | {
      name: "mail.draft.upsert_result";
      props: {
        action: "created" | "updated" | "unchanged" | "blocked_user_edited";
        durationMs?: number;
      };
    }
  | {
      name: "mail.label.applied";
      props: {
        state: "ready" | "needs_review" | "error";
        addCount: number;
        removeCount: number;
      };
    }
  | {
      name: "mail.blocked_user_edited";
      props: {
        reason:
          | "missing_marker"
          | "key_mismatch"
          | "version_mismatch"
          | "fingerprint_mismatch"
          | "unknown";
      };
    }
  | {
      name: "mail.failure.classified";
      props: {
        kind: string;
        retry: string;
        labelState: "needs_review" | "error";
      };
    }
  | {
      name: "mail.resync.decided";
      props: {
        mode: "bounded_backfill" | "full_resync";
        reason: string;
        backfillDays?: number;
      };
    };
