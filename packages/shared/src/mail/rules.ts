import type { MailMessage, MailThread } from "./types";

export type CopilotTriageAction =
  | { kind: "draft"; stateLabel: "ready" }
  | { kind: "needs_review"; stateLabel: "needs_review" }
  | { kind: "ignore"; reason: IgnoreReason };

export type IgnoreReason =
  | "not_in_inbox"
  | "in_spam_or_trash"
  | "latest_is_operator_sent"
  | "auto_reply_or_no_reply"
  | "missing_required_fields";

export type NeedsReviewReason =
  | "sensitive_refund_or_cancellation"
  | "sensitive_medical"
  | "sensitive_safety"
  | "sensitive_legal"
  | "sensitive_exception_request"
  | "multi_party_thread"
  | "thread_has_user_draft"
  | "user_edited_draft_detected"
  | "ambiguous_sender"
  | "other";

export interface CopilotTriageResult {
  action: "draft" | "needs_review" | "ignore";
  reason: NeedsReviewReason | IgnoreReason;
  notes?: string;
}

const SPAM_OR_TRASH_LABELS = new Set(["spam", "trash"]);
const INBOX_LABEL = "inbox";

const SENSITIVE_KEYWORDS: Record<
  Exclude<NeedsReviewReason, "multi_party_thread" | "user_edited_draft_detected" | "ambiguous_sender" | "other">,
  string[]
> = {
  sensitive_refund_or_cancellation: [
    "refund",
    "chargeback",
    "dispute",
    "cancel",
    "cancellation",
    "money back"
  ],
  sensitive_medical: [
    "medical",
    "allergy",
    "asthma",
    "injury",
    "pregnant",
    "doctor"
  ],
  sensitive_safety: [
    "unsafe",
    "accident",
    "incident",
    "injured",
    "lost",
    "emergency"
  ],
  sensitive_legal: ["lawyer", "legal", "liability", "sue", "lawsuit"],
  sensitive_exception_request: [
    "exception",
    "special request",
    "waive",
    "policy exception"
  ],
  thread_has_user_draft: []
};

const normalize = (value: string): string => value.trim().toLowerCase();

const getLabelStrings = (labels?: readonly unknown[]): string[] =>
  (labels ?? []).map((label) => normalize(String(label)));

const includesAnyLabel = (labels: readonly string[], expected: Set<string>): boolean =>
  labels.some((label) => expected.has(label));

const includesInbox = (labels: readonly string[]): boolean =>
  labels.includes(INBOX_LABEL);

const getLatestMessage = (messages: MailThread["messages"]): MailMessage | undefined => {
  if (messages.length === 0) {
    return undefined;
  }

  let latest = messages[0];
  for (let i = 1; i < messages.length; i += 1) {
    const candidate = messages[i];
    if (candidate.internalDateMs >= latest.internalDateMs) {
      latest = candidate;
    }
  }
  return latest;
};

const isNoReplyOrAutoReply = (message: MailMessage): boolean => {
  const fromEmail = normalize(message.participants.from.email);
  if (fromEmail.includes("no-reply") || fromEmail.includes("noreply")) {
    return true;
  }

  const autoSubmittedHeader = Object.entries(message.headers ?? {}).find(
    ([key]) => normalize(key) === "auto-submitted"
  );
  if (!autoSubmittedHeader) {
    return false;
  }

  return normalize(autoSubmittedHeader[1]).includes("auto");
};

const getSensitiveReason = (message: MailMessage): NeedsReviewReason | undefined => {
  const text = normalize(
    [message.subject ?? "", message.snippet ?? "", message.body?.text ?? ""].join(" ")
  );

  for (const [reason, keywords] of Object.entries(SENSITIVE_KEYWORDS) as Array<
    [Exclude<NeedsReviewReason, "multi_party_thread" | "user_edited_draft_detected" | "ambiguous_sender" | "other">, string[]]
  >) {
    if (keywords.some((keyword) => text.includes(normalize(keyword)))) {
      return reason;
    }
  }

  return undefined;
};

export function triageThreadForCopilot(input: {
  thread: MailThread;
  hasUserDraft?: boolean;
  hasCopilotDraft?: boolean;
  operatorEmails?: string[];
}): CopilotTriageResult {
  const latest = getLatestMessage(input.thread.messages);
  if (!latest) {
    return { action: "ignore", reason: "missing_required_fields" };
  }

  if (!latest.participants.from.email) {
    return { action: "ignore", reason: "missing_required_fields" };
  }

  const latestLabels = getLabelStrings(latest.labelIds);
  if (includesAnyLabel(latestLabels, SPAM_OR_TRASH_LABELS)) {
    return { action: "ignore", reason: "in_spam_or_trash" };
  }

  const threadLabels = getLabelStrings(input.thread.labelIds);
  if (!includesInbox(threadLabels) && !includesInbox(latestLabels)) {
    return { action: "ignore", reason: "not_in_inbox" };
  }

  if (input.hasUserDraft === true) {
    return { action: "needs_review", reason: "thread_has_user_draft" };
  }

  const operatorEmails = (input.operatorEmails ?? []).map((email) => normalize(email));
  if (operatorEmails.length > 0) {
    const fromEmail = normalize(latest.participants.from.email);
    if (operatorEmails.includes(fromEmail)) {
      return { action: "ignore", reason: "latest_is_operator_sent" };
    }
  } else {
    return { action: "needs_review", reason: "ambiguous_sender" };
  }

  if (isNoReplyOrAutoReply(latest)) {
    return { action: "ignore", reason: "auto_reply_or_no_reply" };
  }

  const sensitiveReason = getSensitiveReason(latest);
  if (sensitiveReason) {
    return { action: "needs_review", reason: sensitiveReason };
  }

  const recipientCount = latest.participants.to.length;
  const ccCount = latest.participants.cc?.length ?? 0;
  const bccCount = latest.participants.bcc?.length ?? 0;
  if (recipientCount > 1 || ccCount > 0 || bccCount > 0) {
    return { action: "needs_review", reason: "multi_party_thread" };
  }

  return { action: "draft", reason: "other" };
}
