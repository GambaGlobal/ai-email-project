export type MailFailureKind =
  | "auth_revoked"
  | "permission_denied"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_timeout"
  | "invalid_cursor"
  | "needs_full_sync"
  | "message_not_found"
  | "thread_not_found"
  | "draft_conflict_user_edited"
  | "bad_request"
  | "unknown";

export type RetryClass = "none" | "immediate" | "backoff" | "manual";

export type FailureLabelState = "needs_review" | "error";

export interface MailFailureEvent {
  kind: MailFailureKind;
  retry: RetryClass;
  labelState: FailureLabelState;
  code?: string;
  notes?: string;
  providerStatus?: number | string;
}

const FAILURE_DEFAULTS: Record<
  MailFailureKind,
  {
    retry: RetryClass;
    labelState: FailureLabelState;
    code: string;
  }
> = {
  auth_revoked: {
    retry: "manual",
    labelState: "error",
    code: "AUTH_REVOKED"
  },
  permission_denied: {
    retry: "manual",
    labelState: "error",
    code: "PERMISSION_DENIED"
  },
  rate_limited: {
    retry: "backoff",
    labelState: "error",
    code: "RATE_LIMITED"
  },
  provider_unavailable: {
    retry: "backoff",
    labelState: "error",
    code: "PROVIDER_UNAVAILABLE"
  },
  provider_timeout: {
    retry: "backoff",
    labelState: "error",
    code: "PROVIDER_TIMEOUT"
  },
  invalid_cursor: {
    retry: "immediate",
    labelState: "error",
    code: "INVALID_CURSOR"
  },
  needs_full_sync: {
    retry: "immediate",
    labelState: "error",
    code: "NEEDS_FULL_SYNC"
  },
  message_not_found: {
    retry: "none",
    labelState: "needs_review",
    code: "MESSAGE_NOT_FOUND"
  },
  thread_not_found: {
    retry: "none",
    labelState: "needs_review",
    code: "THREAD_NOT_FOUND"
  },
  draft_conflict_user_edited: {
    retry: "none",
    labelState: "needs_review",
    code: "DRAFT_CONFLICT_USER_EDITED"
  },
  bad_request: {
    retry: "none",
    labelState: "error",
    code: "BAD_REQUEST"
  },
  unknown: {
    retry: "backoff",
    labelState: "error",
    code: "UNKNOWN"
  }
};

export function classifyMailFailure(input: {
  kind: MailFailureKind;
  providerStatus?: number | string;
  context?: "ingestion" | "thread_fetch" | "draft_upsert" | "label_apply";
}): MailFailureEvent {
  const defaults = FAILURE_DEFAULTS[input.kind];
  return {
    kind: input.kind,
    retry: defaults.retry,
    labelState: defaults.labelState,
    code: defaults.code,
    providerStatus: input.providerStatus,
    notes: input.context
  };
}

export type ResyncMode = "bounded_backfill" | "full_resync";

export interface ResyncDecision {
  mode: ResyncMode;
  reason: "cursor_gap" | "invalid_cursor" | "operator_requested" | "unknown";
  backfillDays?: number;
}

export function decideResync(input: {
  needsFullSync?: boolean;
  failureKind?: MailFailureKind;
}): ResyncDecision | null {
  if (input.needsFullSync === true) {
    return {
      mode: "bounded_backfill",
      reason: "cursor_gap",
      backfillDays: 7
    };
  }

  if (input.failureKind === "invalid_cursor") {
    return {
      mode: "bounded_backfill",
      reason: "invalid_cursor",
      backfillDays: 7
    };
  }

  return null;
}
