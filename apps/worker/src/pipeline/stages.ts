import type {
  LabelKey,
  MailChange,
  MailboxId,
  NormalizedThread,
  ThreadStateDecision,
  ThreadStateReasonCode,
  ThreadId,
  UpsertThreadDraftResponse
} from "@ai-email/shared";
import { MissingRecipientError } from "../../../../packages/mail-gmail/src/errors.js";
import {
  type SyncMailboxResult,
  type SyncMailboxInput,
  AI_STATE_LABEL_SPECS
} from "../mailbox-sync.js";
import type {
  EnqueueStageFn,
  EnsureLabelsFn,
  FetchThreadJobPayload,
  GenerateJobPayload,
  MailboxSyncJobPayload,
  MailboxSyncStageSummary,
  PipelineFlags,
  PipelineWriteResult,
  QueueTargetStage,
  RetrieveContext,
  RetrieveJobPayload,
  SetStateLabelsFn,
  ThreadStateLabels,
  TriageJobPayload,
  WritebackJobPayload
} from "./types.js";

const DEFAULT_USER_ID = "me";
const DEFAULT_DRAFT_SUBJECT = "Re: (no subject)";
const HOLDING_REPLY_TEXT =
  "Thanks for reaching out. We received your message and will follow up with a detailed reply shortly.";

export function makePipelineJobId(stage: QueueTargetStage, input: {
  tenantId: string;
  mailboxId: string;
  threadId: string;
  triggeringMessageId: string;
}): string {
  return `${stage}:${input.tenantId}:${input.mailboxId}:${input.threadId}:${input.triggeringMessageId}`;
}

function toDeterministicThreadGroups(changes: MailChange[]): Array<{
  threadId: string;
  triggeringMessageId: string;
}> {
  const threadToMessages = new Map<string, string[]>();

  for (const change of changes) {
    const threadId = String(change.threadId);
    const messageId =
      change.kind === "threadLabelsChanged"
        ? `thread:${threadId}`
        : String(change.messageId);
    const existing = threadToMessages.get(threadId) ?? [];
    existing.push(messageId);
    threadToMessages.set(threadId, existing);
  }

  return Array.from(threadToMessages.entries())
    .map(([threadId, messageIds]) => {
      const sorted = [...messageIds].sort((left, right) => left.localeCompare(right));
      return {
        threadId,
        triggeringMessageId: sorted[sorted.length - 1]
      };
    })
    .sort((left, right) => left.threadId.localeCompare(right.threadId));
}

function determineTriageDecision(thread: NormalizedThread): ThreadStateDecision {
  if (thread.messages.length === 0) {
    return {
      state: "needs_review",
      reasonCode: "PROVIDER_ERROR"
    };
  }

  return {
    state: "drafted",
    reasonCode: "OK_DRAFTED"
  };
}

function generateDraft(input: { thread: NormalizedThread }): { subject: string; bodyText: string } {
  const subjectBase = input.thread.subject?.trim() || DEFAULT_DRAFT_SUBJECT;
  const subject = /^re:/i.test(subjectBase) ? subjectBase : `Re: ${subjectBase}`;
  return {
    subject,
    bodyText: HOLDING_REPLY_TEXT
  };
}

type PipelineStageDependencies = {
  runSyncMailbox: (request: SyncMailboxInput) => Promise<SyncMailboxResult>;
  commitCursor: (input: { tenantId: string; mailboxId: string; nextHistoryId: string }) => Promise<void>;
  fetchThread: (input: {
    tenantId: string;
    mailboxId: string;
    userId: string;
    threadId: string;
  }) => Promise<NormalizedThread>;
  upsertThreadDraft: (input: {
    tenantId: string;
    mailboxId: MailboxId;
    userId: string;
    threadId: ThreadId;
    subject: string;
    bodyText: string;
    idempotencyKey: string;
    triggeringMessageId: string;
  }) => Promise<UpsertThreadDraftResponse>;
  ensureLabels: EnsureLabelsFn;
  setThreadStateLabels: SetStateLabelsFn;
  enqueueStage: EnqueueStageFn;
};

function buildLabelCache(ensureLabels: EnsureLabelsFn): (input: {
  tenantId: string;
  mailboxId: MailboxId;
  userId: string;
}) => Promise<ThreadStateLabels> {
  const cache = new Map<string, Promise<ThreadStateLabels>>();

  return async (input) => {
    const cacheKey = `${input.tenantId}:${input.mailboxId}:${input.userId}`;
    const existing = cache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const ensuredPromise = ensureLabels({
      tenantId: input.tenantId,
      mailboxId: input.mailboxId,
      userId: input.userId,
      labels: AI_STATE_LABEL_SPECS
    }).then((result) => result.labelIdsByKey);

    cache.set(cacheKey, ensuredPromise);
    return ensuredPromise;
  };
}

export function createPipelineStageHandlers(input: {
  deps: PipelineStageDependencies;
  flags: PipelineFlags;
}) {
  const { deps, flags } = input;
  const getLabelIds = buildLabelCache(deps.ensureLabels);

  return {
    async handleMailboxSync(job: MailboxSyncJobPayload): Promise<MailboxSyncStageSummary> {
      const tenantId = job.tenantId;
      const mailboxId = job.mailboxId;
      const userId = job.userId ?? DEFAULT_USER_ID;

      const syncResult = await deps.runSyncMailbox({
        tenantId,
        mailboxId,
        commitCursor: false
      });

      if (!flags.syncEnqueueEnabled) {
        return {
          startHistoryId: syncResult.startHistoryId,
          nextHistoryId: syncResult.nextHistoryId,
          changes: syncResult.changes,
          changeCount: syncResult.changes.length,
          threadCount: 0,
          cursorCommitted: false
        };
      }

      const groupedChanges = toDeterministicThreadGroups(syncResult.changes);

      for (const grouped of groupedChanges) {
        const payload: FetchThreadJobPayload = {
          tenantId,
          mailboxId,
          userId,
          threadId: grouped.threadId,
          triggeringMessageId: grouped.triggeringMessageId
        };

        await deps.enqueueStage({
          stage: "fetch_thread",
          payload,
          jobId: makePipelineJobId("fetch_thread", payload)
        });
      }

      await deps.commitCursor({
        tenantId,
        mailboxId,
        nextHistoryId: syncResult.nextHistoryId
      });

      return {
        startHistoryId: syncResult.startHistoryId,
        nextHistoryId: syncResult.nextHistoryId,
        changes: syncResult.changes,
        changeCount: syncResult.changes.length,
        threadCount: groupedChanges.length,
        cursorCommitted: true
      };
    },

    async handleFetchThread(job: FetchThreadJobPayload): Promise<void> {
      const thread = await deps.fetchThread({
        tenantId: job.tenantId,
        mailboxId: job.mailboxId,
        userId: job.userId,
        threadId: job.threadId
      });

      const payload: TriageJobPayload = {
        ...job,
        thread
      };

      await deps.enqueueStage({
        stage: "triage",
        payload,
        jobId: makePipelineJobId("triage", payload)
      });
    },

    async handleTriage(job: TriageJobPayload): Promise<void> {
      const triageDecision = determineTriageDecision(job.thread);
      const payload: RetrieveJobPayload = {
        ...job,
        triageDecision
      };

      await deps.enqueueStage({
        stage: "retrieve",
        payload,
        jobId: makePipelineJobId("retrieve", payload)
      });
    },

    async handleRetrieve(job: RetrieveJobPayload): Promise<void> {
      const retrievedContext: RetrieveContext = {
        snippets: []
      };

      const payload: GenerateJobPayload = {
        ...job,
        retrievedContext
      };

      await deps.enqueueStage({
        stage: "generate",
        payload,
        jobId: makePipelineJobId("generate", payload)
      });
    },

    async handleGenerate(job: GenerateJobPayload): Promise<void> {
      const draft = generateDraft({ thread: job.thread });
      const payload: WritebackJobPayload = {
        tenantId: job.tenantId,
        mailboxId: job.mailboxId,
        userId: job.userId,
        threadId: job.threadId,
        triggeringMessageId: job.triggeringMessageId,
        thread: job.thread,
        subject: draft.subject,
        bodyText: draft.bodyText,
        idempotencyKey: `${job.tenantId}:${job.mailboxId}:${job.triggeringMessageId}`,
        triageDecision: job.triageDecision
      };

      await deps.enqueueStage({
        stage: "writeback",
        payload,
        jobId: makePipelineJobId("writeback", payload)
      });
    },

    async handleWriteback(job: WritebackJobPayload): Promise<PipelineWriteResult> {
      let state = job.triageDecision.state;
      let reasonCode: ThreadStateReasonCode = job.triageDecision.reasonCode;
      let upsertResult: UpsertThreadDraftResponse | undefined;

      if (flags.draftWritebackEnabled && state === "drafted") {
        try {
          upsertResult = await deps.upsertThreadDraft({
            tenantId: job.tenantId,
            mailboxId: job.mailboxId as MailboxId,
            userId: job.userId,
            threadId: job.threadId as ThreadId,
            subject: job.subject,
            bodyText: job.bodyText,
            idempotencyKey: job.idempotencyKey,
            triggeringMessageId: job.triggeringMessageId
          });
        } catch (error) {
          if (error instanceof MissingRecipientError) {
            state = "needs_review";
            reasonCode = "MISSING_RECIPIENT";
          } else {
            throw error;
          }
        }
      }

      if (flags.applyLabelsEnabled) {
        const labelIdsByKey = await getLabelIds({
          tenantId: job.tenantId,
          mailboxId: job.mailboxId as MailboxId,
          userId: job.userId
        });

        await deps.setThreadStateLabels({
          tenantId: job.tenantId,
          mailboxId: job.mailboxId as MailboxId,
          userId: job.userId,
          threadId: job.threadId as ThreadId,
          state,
          labelIdsByKey
        });
      }

      return {
        upsertResult,
        state,
        reasonCode
      };
    }
  };
}
