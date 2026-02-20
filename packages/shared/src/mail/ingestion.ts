export const CANONICAL_SYSTEM_LABELS = {
  inbox: "INBOX",
  spam: "SPAM",
  trash: "TRASH"
} as const;

export type CanonicalSystemLabel =
  (typeof CANONICAL_SYSTEM_LABELS)[keyof typeof CANONICAL_SYSTEM_LABELS];

export interface MailboxCursorState {
  cursor?: string;
  updatedAt?: string;
}

export interface IngestionPlan {
  mailboxId: string;
  fromCursor?: string;
  nextCursor?: string;
  messageIds: string[];
  threadIds: string[];
  needsFullSync?: boolean;
}

export const IDEMPOTENCY_KEYS = {
  message: "mailboxId:messageId",
  threadDraftSlot: "mailboxId:threadId:draftKind",
  cursorUpdate: "mailboxId:cursor"
} as const;

const CANONICAL_LABEL_SET = new Set<CanonicalSystemLabel>([
  CANONICAL_SYSTEM_LABELS.inbox,
  CANONICAL_SYSTEM_LABELS.spam,
  CANONICAL_SYSTEM_LABELS.trash
]);

export function normalizeSystemLabels(
  input: readonly unknown[]
): readonly CanonicalSystemLabel[] {
  const result: CanonicalSystemLabel[] = [];
  const seen = new Set<CanonicalSystemLabel>();

  for (const rawLabel of input) {
    const normalized = String(rawLabel).trim().toUpperCase();
    if (!CANONICAL_LABEL_SET.has(normalized as CanonicalSystemLabel)) {
      continue;
    }

    const canonical = normalized as CanonicalSystemLabel;
    if (seen.has(canonical)) {
      continue;
    }

    seen.add(canonical);
    result.push(canonical);
  }

  return result;
}

export function deriveWorkItemsFromChanges(input: {
  mailboxId: string;
  fromCursor?: string;
  changes: ReadonlyArray<{ kind: string; messageId?: string; threadId?: string }>;
  nextCursor: string;
  needsFullSync?: boolean;
}): IngestionPlan {
  const messageIds: string[] = [];
  const threadIds: string[] = [];
  const seenMessageIds = new Set<string>();
  const seenThreadIds = new Set<string>();

  for (const change of input.changes) {
    if (change.messageId && !seenMessageIds.has(change.messageId)) {
      seenMessageIds.add(change.messageId);
      messageIds.push(change.messageId);
    }

    if (change.threadId && !seenThreadIds.has(change.threadId)) {
      seenThreadIds.add(change.threadId);
      threadIds.push(change.threadId);
    }
  }

  return {
    mailboxId: input.mailboxId,
    fromCursor: input.fromCursor,
    nextCursor: input.nextCursor,
    messageIds,
    threadIds,
    needsFullSync: input.needsFullSync
  };
}
