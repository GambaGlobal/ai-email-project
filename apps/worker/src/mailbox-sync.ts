import type {
  Cursor,
  MailBody,
  MailChange,
  MailboxId,
  MessageId,
  NormalizedThread,
  ThreadId,
  UpsertThreadDraftResponse
} from "@ai-email/shared";
import { GmailHistoryExpiredError } from "../../../packages/mail-gmail/src/errors.js";

export interface MailboxCursorStore {
  get(tenantId: string, mailboxId: string): Promise<string | null>;
  set(tenantId: string, mailboxId: string, historyId: string): Promise<void>;
}

export type MailboxSyncProvider = {
  listChanges(input: {
    tenantId: string;
    mailboxId: string;
    startHistoryId: string;
  }): Promise<{ changes: MailChange[]; nextHistoryId: string }>;
  getBaselineHistoryId(input: {
    tenantId: string;
    mailboxId: string;
  }): Promise<string>;
};

export type NormalizedThreadFetcher = (input: {
  tenantId: string;
  mailboxId: string;
  threadId: string;
}) => Promise<NormalizedThread>;

export type DraftUpsertProvider = {
  upsertThreadDraft(input: {
    mailboxId: MailboxId;
    threadId: ThreadId;
    replyToMessageId: MessageId;
    subject?: string;
    body: MailBody;
    idempotencyKey: string;
  }): Promise<UpsertThreadDraftResponse>;
};

export class MemoryCursorStore implements MailboxCursorStore {
  private readonly entries = new Map<string, string>();

  async get(tenantId: string, mailboxId: string): Promise<string | null> {
    return this.entries.get(`${tenantId}:${mailboxId}`) ?? null;
  }

  async set(tenantId: string, mailboxId: string, historyId: string): Promise<void> {
    this.entries.set(`${tenantId}:${mailboxId}`, historyId);
  }
}

export class MailboxNeedsFullResyncError extends Error {
  readonly tenantId: string;
  readonly mailboxId: string;
  readonly startHistoryId: string;

  constructor(input: { tenantId: string; mailboxId: string; startHistoryId: string; cause?: unknown }) {
    super(
      `Mailbox requires full resync for tenant=${input.tenantId} mailbox=${input.mailboxId} startHistoryId=${input.startHistoryId}`
    );
    this.name = "MailboxNeedsFullResyncError";
    this.tenantId = input.tenantId;
    this.mailboxId = input.mailboxId;
    this.startHistoryId = input.startHistoryId;
    if (input.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = input.cause;
    }
  }
}

export type SyncMailboxInput = {
  tenantId: string;
  mailboxId: string;
  commitCursor: boolean;
};

export type SyncMailboxResult = {
  startHistoryId: string;
  nextHistoryId: string;
  changes: MailChange[];
  mode: "bootstrap" | "incremental";
};

export async function syncMailbox(input: {
  cursorStore: MailboxCursorStore;
  provider: MailboxSyncProvider;
  request: SyncMailboxInput;
}): Promise<SyncMailboxResult> {
  const { cursorStore, provider, request } = input;
  const currentCursor = await cursorStore.get(request.tenantId, request.mailboxId);

  if (!currentCursor) {
    const baselineHistoryId = await provider.getBaselineHistoryId({
      tenantId: request.tenantId,
      mailboxId: request.mailboxId
    });

    if (request.commitCursor) {
      await cursorStore.set(request.tenantId, request.mailboxId, baselineHistoryId);
    }

    return {
      startHistoryId: baselineHistoryId,
      nextHistoryId: baselineHistoryId,
      changes: [],
      mode: "bootstrap"
    };
  }

  let listed: { changes: MailChange[]; nextHistoryId: string };
  try {
    listed = await provider.listChanges({
      tenantId: request.tenantId,
      mailboxId: request.mailboxId,
      startHistoryId: currentCursor
    });
  } catch (error) {
    if (error instanceof GmailHistoryExpiredError) {
      throw new MailboxNeedsFullResyncError({
        tenantId: request.tenantId,
        mailboxId: request.mailboxId,
        startHistoryId: currentCursor,
        cause: error
      });
    }
    throw error;
  }

  if (request.commitCursor) {
    await cursorStore.set(request.tenantId, request.mailboxId, listed.nextHistoryId);
  }

  return {
    startHistoryId: currentCursor,
    nextHistoryId: listed.nextHistoryId,
    changes: listed.changes,
    mode: "incremental"
  };
}

export function toCursor(historyId: string): Cursor {
  return historyId as Cursor;
}

export async function collectThreadContextsForChanges(input: {
  tenantId: string;
  mailboxId: string;
  changes: MailChange[];
  fetchThread: NormalizedThreadFetcher;
}): Promise<NormalizedThread[]> {
  const resolveThreadId = (change: MailChange): string | null => {
    if (change.kind === "threadLabelsChanged") {
      return String(change.threadId);
    }
    if (change.kind === "messageAdded" || change.kind === "messageLabelsChanged") {
      return String(change.threadId);
    }
    return null;
  };

  const threadIds = Array.from(
    new Set(
      input.changes
        .map((change) => resolveThreadId(change))
        .filter((threadId): threadId is string => typeof threadId === "string" && threadId.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right));

  return Promise.all(
    threadIds.map((threadId) =>
      input.fetchThread({
        tenantId: input.tenantId,
        mailboxId: input.mailboxId,
        threadId
      })
    )
  );
}

export async function runDraftUpsertIdempotencyHarness(input: {
  provider: DraftUpsertProvider;
  mailboxId: MailboxId;
  threadId: ThreadId;
  replyToMessageId: MessageId;
  idempotencyKey: string;
  subject?: string;
  bodyText: string;
}): Promise<{
  first: UpsertThreadDraftResponse;
  second: UpsertThreadDraftResponse;
}> {
  const request = {
    mailboxId: input.mailboxId,
    threadId: input.threadId,
    replyToMessageId: input.replyToMessageId,
    idempotencyKey: input.idempotencyKey,
    subject: input.subject,
    body: {
      text: input.bodyText
    }
  };
  const first = await input.provider.upsertThreadDraft(request);
  const second = await input.provider.upsertThreadDraft(request);
  return { first, second };
}
