import { IDEMPOTENCY_KEYS } from "./ingestion";

export function mailboxCursorKey(mailboxId: string): string {
  return `${mailboxId}:cursor`;
}

export function messageWorkKey(mailboxId: string, messageId: string): string {
  return `${mailboxId}:message:${messageId}`;
}

export function threadWorkKey(mailboxId: string, threadId: string): string {
  return `${mailboxId}:thread:${threadId}`;
}

export function draftSlotKey(
  mailboxId: string,
  threadId: string,
  kind: string
): string {
  return `${mailboxId}:thread:${threadId}:draft:${kind}`;
}

export const LOCK_KEYS = {
  threadSingleFlight: (mailboxId: string, threadId: string): string =>
    `lock:${threadWorkKey(mailboxId, threadId)}`,
  draftSlotSingleFlight: (
    mailboxId: string,
    threadId: string,
    kind: string
  ): string => `lock:${draftSlotKey(mailboxId, threadId, kind)}`
} as const;

export const IDEMPOTENCY_KEY_TEMPLATES = {
  message: IDEMPOTENCY_KEYS.message,
  threadDraftSlot: IDEMPOTENCY_KEYS.threadDraftSlot,
  cursorUpdate: IDEMPOTENCY_KEYS.cursorUpdate
} as const;

export function pickLatestMessageId(input: {
  messageIds: readonly string[];
  messageDateMsById?: Record<string, number>;
}): string | undefined {
  if (input.messageIds.length === 0) {
    return undefined;
  }

  if (!input.messageDateMsById) {
    return input.messageIds[input.messageIds.length - 1];
  }

  let latestId = input.messageIds[0];
  let latestDate = input.messageDateMsById[latestId] ?? Number.NEGATIVE_INFINITY;

  for (let i = 1; i < input.messageIds.length; i += 1) {
    const candidateId = input.messageIds[i];
    const candidateDate =
      input.messageDateMsById[candidateId] ?? Number.NEGATIVE_INFINITY;

    if (candidateDate > latestDate) {
      latestId = candidateId;
      latestDate = candidateDate;
      continue;
    }

    if (candidateDate === latestDate && candidateId.localeCompare(latestId) > 0) {
      latestId = candidateId;
    }
  }

  return latestId;
}

export function isStaleWork(input: {
  candidateInternalDateMs: number;
  latestInternalDateMs: number;
}): boolean {
  return input.candidateInternalDateMs < input.latestInternalDateMs;
}
