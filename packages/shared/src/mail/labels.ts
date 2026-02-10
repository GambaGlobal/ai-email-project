/**
 * v1 labels are applied at the thread level to make state visible inside Gmail.
 * Exactly one state label should be present at a time.
 * Outlook and other providers should map these states to equivalent categories.
 */
export type CopilotThreadState = "ready" | "needs_review" | "error";

export const COPILOT_LABEL_NAMESPACE = "Inbox Copilot" as const;

export const COPILOT_LABELS = {
  ready: `${COPILOT_LABEL_NAMESPACE}/Ready`,
  needsReview: `${COPILOT_LABEL_NAMESPACE}/Needs review`,
  error: `${COPILOT_LABEL_NAMESPACE}/Error`
} as const;

export type CopilotLabelName = typeof COPILOT_LABELS[keyof typeof COPILOT_LABELS];

export const COPILOT_STATE_LABELS: readonly CopilotLabelName[] = [
  COPILOT_LABELS.ready,
  COPILOT_LABELS.needsReview,
  COPILOT_LABELS.error
];

export function getCopilotStateLabel(state: CopilotThreadState): CopilotLabelName {
  if (state === "ready") {
    return COPILOT_LABELS.ready;
  }
  if (state === "needs_review") {
    return COPILOT_LABELS.needsReview;
  }
  return COPILOT_LABELS.error;
}

export function getExclusiveStateLabelSet(
  state: CopilotThreadState
): { add: CopilotLabelName[]; remove: CopilotLabelName[] } {
  const target = getCopilotStateLabel(state);
  return {
    add: [target],
    remove: COPILOT_STATE_LABELS.filter((label) => label !== target)
  };
}
