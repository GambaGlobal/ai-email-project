import { draftSlotKey, messageWorkKey, threadWorkKey } from "./concurrency";
import {
  COPILOT_MARKER_VERSION,
  computeDraftFingerprint,
  isCopilotOwnedDraft,
  shouldUpdateDraft
} from "./drafts";
import { getExclusiveStateLabelSet } from "./labels";
import { triageThreadForCopilot } from "./rules";
import type { MailMessage, MailThread } from "./types";

export type CopilotLifecycleOutcome =
  | { kind: "noop"; reason: string }
  | {
      kind: "label_only";
      state: "needs_review" | "error";
      labels: { add: string[]; remove: string[] };
      notes?: string;
    }
  | {
      kind: "upsert_draft";
      state: "ready";
      draftKey: string;
      draftKind: "copilot_reply";
      threadId: string;
      replyToMessageId: string;
      labels: { add: string[]; remove: string[] };
      idempotency: {
        threadKey: string;
        draftSlotKey: string;
        messageKey: string;
      };
      expectedPreviousFingerprint?: string;
      notes?: string;
    }
  | {
      kind: "blocked_user_edited";
      state: "needs_review";
      labels: { add: string[]; remove: string[] };
      idempotency: { threadKey: string; draftSlotKey: string; messageKey: string };
      notes?: string;
    };

export interface BuildLifecyclePlanInput {
  mailboxId: string;
  operatorEmails?: string[];
  thread: MailThread;
  hasUserDraft?: boolean;
  existingDraft?: {
    draftId?: string;
    headers?: Record<string, string>;
    bodyText?: string;
    bodyHtml?: string;
    subject?: string;
    currentFingerprint?: string;
  };
  expectedPreviousFingerprint?: string;
}

const pickLatestMessage = (thread: MailThread): MailMessage | undefined => {
  if (thread.messages.length === 0) {
    return undefined;
  }

  let latest = thread.messages[0];
  for (let i = 1; i < thread.messages.length; i += 1) {
    const candidate = thread.messages[i];
    if (candidate.internalDateMs >= latest.internalDateMs) {
      latest = candidate;
    }
  }
  return latest;
};

const buildNeedsReviewLabels = (): { add: string[]; remove: string[] } => {
  const set = getExclusiveStateLabelSet("needs_review");
  return { add: [...set.add], remove: [...set.remove] };
};

const buildReadyLabels = (): { add: string[]; remove: string[] } => {
  const set = getExclusiveStateLabelSet("ready");
  return { add: [...set.add], remove: [...set.remove] };
};

export function buildCopilotLifecyclePlan(
  input: BuildLifecyclePlanInput
): CopilotLifecycleOutcome {
  const latestMessage = pickLatestMessage(input.thread);
  if (!latestMessage) {
    return { kind: "noop", reason: "missing_required_fields" };
  }

  const triage = triageThreadForCopilot({
    thread: input.thread,
    hasUserDraft: input.hasUserDraft,
    operatorEmails: input.operatorEmails
  });
  if (triage.action === "ignore") {
    return { kind: "noop", reason: triage.reason };
  }

  if (triage.action === "needs_review") {
    return {
      kind: "label_only",
      state: "needs_review",
      labels: buildNeedsReviewLabels(),
      notes: triage.reason
    };
  }

  const draftKind = "copilot_reply" as const;
  const draftKey = `${input.mailboxId}:${input.thread.id}:${draftKind}`;
  const labels = buildReadyLabels();
  const idempotency = {
    threadKey: threadWorkKey(input.mailboxId, String(input.thread.id)),
    draftSlotKey: draftSlotKey(
      input.mailboxId,
      String(input.thread.id),
      draftKind
    ),
    messageKey: messageWorkKey(input.mailboxId, String(latestMessage.id))
  };

  if (input.existingDraft) {
    const ownership = isCopilotOwnedDraft({
      headers: input.existingDraft.headers,
      bodyText: input.existingDraft.bodyText,
      bodyHtml: input.existingDraft.bodyHtml,
      expectedDraftKey: draftKey
    });
    if (!ownership.owned) {
      return {
        kind: "blocked_user_edited",
        state: "needs_review",
        labels: buildNeedsReviewLabels(),
        idempotency,
        notes: ownership.reason
      };
    }

    const currentFingerprint =
      input.existingDraft.currentFingerprint ??
      computeDraftFingerprint({
        marker: {
          draftKey,
          version: COPILOT_MARKER_VERSION
        },
        subject: input.existingDraft.subject,
        bodyText: input.existingDraft.bodyText ?? "",
        bodyHtml: input.existingDraft.bodyHtml
      });

    const updateDecision = shouldUpdateDraft({
      owned: true,
      expectedPreviousFingerprint: input.expectedPreviousFingerprint,
      currentFingerprint
    });
    if (!updateDecision.ok) {
      return {
        kind: "blocked_user_edited",
        state: "needs_review",
        labels: buildNeedsReviewLabels(),
        idempotency,
        notes: updateDecision.reason
      };
    }
  }

  return {
    kind: "upsert_draft",
    state: "ready",
    draftKey,
    draftKind,
    threadId: String(input.thread.id),
    replyToMessageId: String(latestMessage.id),
    labels,
    idempotency,
    expectedPreviousFingerprint: input.expectedPreviousFingerprint
  };
}

export function getOutcomeState(
  outcome: CopilotLifecycleOutcome
): "ready" | "needs_review" | "error" | "noop" {
  if (outcome.kind === "noop") {
    return "noop";
  }
  return outcome.state;
}
