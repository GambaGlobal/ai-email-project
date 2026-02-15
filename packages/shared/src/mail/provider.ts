import type {
  CopilotDraftMarker,
  Cursor,
  DraftId,
  DraftWriteFingerprint,
  LabelId,
  MailBody,
  MailMessage,
  NormalizedThread,
  MailboxId,
  MessageId,
  ThreadId
} from "./types";

export type MailProviderKind = "gmail" | "outlook" | "other";

export interface MailProviderContext<Auth = unknown> {
  mailboxId: MailboxId;
  auth: Auth;
  provider: MailProviderKind;
}

export type MailChange =
  | {
      kind: "messageAdded";
      messageId: MessageId;
      threadId: ThreadId;
      internalDateMs?: number;
    }
  | { kind: "threadLabelsChanged"; threadId: ThreadId }
  | { kind: "messageLabelsChanged"; messageId: MessageId; threadId: ThreadId };

export interface ListChangesRequest {
  cursor?: Cursor;
  limit?: number;
}

export interface ListChangesResponse {
  nextCursor: Cursor;
  changes: MailChange[];
  needsFullSync?: boolean;
}

export interface GetThreadRequest {
  threadId: ThreadId;
  includeBody?: boolean;
}

export interface GetThreadResponse {
  thread: NormalizedThread;
}

export type DraftKind = "copilot_reply";

export interface UpsertThreadDraftRequest {
  threadId: ThreadId;
  kind: DraftKind;
  replyToMessageId: MessageId;
  subject?: string;
  body: MailBody;
  marker: CopilotDraftMarker;
  expectedPreviousFingerprint?: DraftWriteFingerprint;
}

export interface UpsertThreadDraftResponse {
  action: "created" | "updated" | "unchanged" | "blocked_user_edited";
  draftId?: DraftId;
  draftFingerprint?: DraftWriteFingerprint;
}

export interface EnsureLabelRequest {
  name: string;
  parentName?: string;
}

export interface EnsureLabelResponse {
  labelId: LabelId;
}

export interface ModifyThreadLabelsRequest {
  threadId: ThreadId;
  add?: LabelId[];
  remove?: LabelId[];
}

export interface GetDraftRequest {
  draftId: DraftId;
}

export interface DeleteDraftRequest {
  draftId: DraftId;
}

export interface GetDraftResponse {
  draftId: DraftId;
  threadId: ThreadId;
  fingerprint?: DraftWriteFingerprint;
}

export interface MailProvider<Auth = unknown> {
  kind: MailProviderKind;
  /**
   * Lists provider-side mail changes with at-least-once delivery semantics.
   * Consumers must process records idempotently across retries and duplicates.
   */
  listChanges(
    ctx: MailProviderContext<Auth>,
    req: ListChangesRequest
  ): Promise<ListChangesResponse>;
  getThread(
    ctx: MailProviderContext<Auth>,
    req: GetThreadRequest
  ): Promise<GetThreadResponse>;
  ensureLabel(
    ctx: MailProviderContext<Auth>,
    req: EnsureLabelRequest
  ): Promise<EnsureLabelResponse>;
  modifyThreadLabels(
    ctx: MailProviderContext<Auth>,
    req: ModifyThreadLabelsRequest
  ): Promise<void>;
  /**
   * Never overwrite if marker is missing or expectedPreviousFingerprint mismatches;
   * return blocked_user_edited to preserve human edits.
   */
  upsertThreadDraft(
    ctx: MailProviderContext<Auth>,
    req: UpsertThreadDraftRequest
  ): Promise<UpsertThreadDraftResponse>;
  getDraft?(
    ctx: MailProviderContext<Auth>,
    req: GetDraftRequest
  ): Promise<GetDraftResponse>;
  deleteDraft?(
    ctx: MailProviderContext<Auth>,
    req: DeleteDraftRequest
  ): Promise<void>;
}

// Legacy aliases retained to reduce migration churn in existing code.
export type MailProviderWatchState = {
  provider: MailProviderKind;
  cursor: Cursor;
  startedAt: string;
};
export type LegacyMailEvent = {
  type: "mail.message.received";
  mailboxId: MailboxId;
  provider: MailProviderKind;
  providerMessageId: MessageId;
  providerThreadId?: ThreadId;
  occurredAt: string;
  providerCursor?: Cursor;
};
export type LegacyCanonicalMessage = MailMessage;
