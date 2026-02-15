import type {
  LabelId,
  LabelKey,
  MailChange,
  MailboxId,
  NormalizedThread,
  ThreadState,
  ThreadStateDecision,
  ThreadStateReasonCode,
  ThreadId,
  UpsertThreadDraftResponse
} from "@ai-email/shared";

export const PIPELINE_QUEUE_NAMES = {
  mailboxSync: "mailbox_sync",
  fetchThread: "fetch_thread",
  triage: "triage",
  retrieve: "retrieve",
  generate: "generate",
  writeback: "writeback"
} as const;

export type PipelineStage = keyof typeof PIPELINE_QUEUE_NAMES;

export type BaseStageContext = {
  tenantId: string;
  mailboxId: string;
  userId: string;
  threadId: string;
  triggeringMessageId: string;
};

export type MailboxSyncJobPayload = {
  tenantId: string;
  mailboxId: string;
  userId?: string;
};

export type FetchThreadJobPayload = BaseStageContext;

export type TriageJobPayload = BaseStageContext & {
  thread: NormalizedThread;
};

export type RetrieveContext = {
  snippets: string[];
};

export type RetrieveJobPayload = TriageJobPayload & {
  triageDecision: ThreadStateDecision;
};

export type GenerateJobPayload = RetrieveJobPayload & {
  retrievedContext: RetrieveContext;
};

export type WritebackJobPayload = BaseStageContext & {
  thread: NormalizedThread;
  subject: string;
  bodyText: string;
  idempotencyKey: string;
  triageDecision: ThreadStateDecision;
};

export type PipelineStagePayloadMap = {
  fetch_thread: FetchThreadJobPayload;
  triage: TriageJobPayload;
  retrieve: RetrieveJobPayload;
  generate: GenerateJobPayload;
  writeback: WritebackJobPayload;
};

export type PipelineFlags = {
  syncEnqueueEnabled: boolean;
  draftWritebackEnabled: boolean;
  applyLabelsEnabled: boolean;
};

export type PipelineWriteResult = {
  upsertResult?: UpsertThreadDraftResponse;
  state: ThreadState;
  reasonCode: ThreadStateReasonCode;
};

export type ThreadStateLabels = Record<LabelKey, LabelId>;

export type MailboxSyncStageSummary = {
  startHistoryId: string;
  nextHistoryId: string;
  changes: MailChange[];
  changeCount: number;
  threadCount: number;
  cursorCommitted: boolean;
};

export type QueueTargetStage = keyof PipelineStagePayloadMap;

export type EnqueueStageFn = <TStage extends QueueTargetStage>(input: {
  stage: TStage;
  payload: PipelineStagePayloadMap[TStage];
  jobId: string;
}) => Promise<void>;

export type EnsureLabelsFn = (input: {
  tenantId: string;
  mailboxId: MailboxId;
  userId: string;
  labels: { key: LabelKey; name: string }[];
}) => Promise<{ labelIdsByKey: ThreadStateLabels }>;

export type SetStateLabelsFn = (input: {
  tenantId: string;
  mailboxId: MailboxId;
  userId: string;
  threadId: ThreadId;
  state: ThreadState;
  labelIdsByKey: ThreadStateLabels;
}) => Promise<void>;
