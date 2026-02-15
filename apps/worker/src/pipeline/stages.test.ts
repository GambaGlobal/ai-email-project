import assert from "node:assert/strict";
import test from "node:test";
import type { LabelId, MailChange, NormalizedThread } from "@ai-email/shared";
import { MissingRecipientError } from "../../../../packages/mail-gmail/src/errors.js";
import { createPipelineStageHandlers, makePipelineJobId } from "./stages";

function createThread(id: string): NormalizedThread {
  return {
    threadId: id,
    subject: "Trip details",
    participants: [{ email: "guest@example.com" }],
    messages: [
      {
        messageId: "msg-1",
        threadId: id,
        internalDateMs: 1,
        from: { email: "guest@example.com" },
        to: [{ email: "ops@example.com" }],
        cc: [],
        bodyText: "Hello"
      }
    ],
    lastUpdatedMs: 1
  };
}

test("mailbox sync stage groups by thread and enqueues deterministic fetch_thread jobs", async () => {
  const enqueued: Array<{ stage: string; jobId: string; payload: { threadId: string; triggeringMessageId: string } }> = [];
  const committed: string[] = [];
  const changes: MailChange[] = [
    { kind: "messageAdded", threadId: "thread-2" as never, messageId: "msg-2" as never },
    { kind: "messageAdded", threadId: "thread-1" as never, messageId: "msg-1" as never },
    { kind: "messageAdded", threadId: "thread-2" as never, messageId: "msg-3" as never }
  ];

  const handlers = createPipelineStageHandlers({
    flags: {
      syncEnqueueEnabled: true,
      draftWritebackEnabled: false,
      applyLabelsEnabled: false
    },
    deps: {
      async runSyncMailbox() {
        return {
          startHistoryId: "100",
          nextHistoryId: "101",
          changes,
          mode: "incremental"
        };
      },
      async commitCursor(input) {
        committed.push(input.nextHistoryId);
      },
      async fetchThread() {
        return createThread("thread-1");
      },
      async upsertThreadDraft() {
        return { action: "created" };
      },
      async ensureLabels() {
        return {
          labelIdsByKey: {
            ai_drafted: "lbl-1" as LabelId,
            ai_needs_review: "lbl-2" as LabelId,
            ai_blocked: "lbl-3" as LabelId
          }
        };
      },
      async setThreadStateLabels() {},
      async enqueueStage(input) {
        enqueued.push({
          stage: input.stage,
          jobId: input.jobId,
          payload: {
            threadId: (input.payload as { threadId: string }).threadId,
            triggeringMessageId: (input.payload as { triggeringMessageId: string }).triggeringMessageId
          }
        });
      }
    }
  });

  const result = await handlers.handleMailboxSync({
    tenantId: "tenant-1",
    mailboxId: "mailbox-1"
  });

  assert.equal(result.cursorCommitted, true);
  assert.deepEqual(committed, ["101"]);
  assert.deepEqual(
    enqueued.map((entry) => ({ stage: entry.stage, jobId: entry.jobId, threadId: entry.payload.threadId })),
    [
      {
        stage: "fetch_thread",
        jobId: makePipelineJobId("fetch_thread", {
          tenantId: "tenant-1",
          mailboxId: "mailbox-1",
          threadId: "thread-1",
          triggeringMessageId: "msg-1"
        }),
        threadId: "thread-1"
      },
      {
        stage: "fetch_thread",
        jobId: makePipelineJobId("fetch_thread", {
          tenantId: "tenant-1",
          mailboxId: "mailbox-1",
          threadId: "thread-2",
          triggeringMessageId: "msg-3"
        }),
        threadId: "thread-2"
      }
    ]
  );
});

test("fetch_thread stage enqueues triage with normalized thread", async () => {
  const triagePayloads: unknown[] = [];

  const handlers = createPipelineStageHandlers({
    flags: {
      syncEnqueueEnabled: true,
      draftWritebackEnabled: false,
      applyLabelsEnabled: false
    },
    deps: {
      async runSyncMailbox() {
        return {
          startHistoryId: "0",
          nextHistoryId: "0",
          changes: [],
          mode: "bootstrap"
        };
      },
      async commitCursor() {},
      async fetchThread(input) {
        return createThread(input.threadId);
      },
      async upsertThreadDraft() {
        return { action: "created" };
      },
      async ensureLabels() {
        return {
          labelIdsByKey: {
            ai_drafted: "lbl-1" as LabelId,
            ai_needs_review: "lbl-2" as LabelId,
            ai_blocked: "lbl-3" as LabelId
          }
        };
      },
      async setThreadStateLabels() {},
      async enqueueStage(input) {
        if (input.stage === "triage") {
          triagePayloads.push(input.payload);
        }
      }
    }
  });

  await handlers.handleFetchThread({
    tenantId: "tenant-1",
    mailboxId: "mailbox-1",
    userId: "me",
    threadId: "thread-3",
    triggeringMessageId: "msg-8"
  });

  assert.equal(triagePayloads.length, 1);
  assert.equal((triagePayloads[0] as { thread: { threadId: string } }).thread.threadId, "thread-3");
});

test("writeback stage respects env gating and maps MissingRecipientError deterministically", async () => {
  let upsertCalls = 0;
  const labelStates: string[] = [];

  const handlers = createPipelineStageHandlers({
    flags: {
      syncEnqueueEnabled: true,
      draftWritebackEnabled: true,
      applyLabelsEnabled: true
    },
    deps: {
      async runSyncMailbox() {
        return {
          startHistoryId: "0",
          nextHistoryId: "0",
          changes: [],
          mode: "bootstrap"
        };
      },
      async commitCursor() {},
      async fetchThread() {
        return createThread("thread-1");
      },
      async upsertThreadDraft() {
        upsertCalls += 1;
        throw new MissingRecipientError({ threadId: "thread-1" });
      },
      async ensureLabels() {
        return {
          labelIdsByKey: {
            ai_drafted: "lbl-1" as LabelId,
            ai_needs_review: "lbl-2" as LabelId,
            ai_blocked: "lbl-3" as LabelId
          }
        };
      },
      async setThreadStateLabels(input) {
        labelStates.push(input.state);
      },
      async enqueueStage() {}
    }
  });

  const result = await handlers.handleWriteback({
    tenantId: "tenant-1",
    mailboxId: "mailbox-1",
    userId: "me",
    threadId: "thread-1",
    triggeringMessageId: "msg-2",
    thread: createThread("thread-1"),
    subject: "Re: Trip details",
    bodyText: "Holding reply",
    idempotencyKey: "tenant-1:mailbox-1:msg-2",
    triageDecision: {
      state: "drafted",
      reasonCode: "OK_DRAFTED"
    }
  });

  assert.equal(upsertCalls, 1);
  assert.equal(result.state, "needs_review");
  assert.equal(result.reasonCode, "MISSING_RECIPIENT");
  assert.deepEqual(labelStates, ["needs_review"]);
});

test("writeback stage does not call provider when draft writeback is disabled", async () => {
  let upsertCalls = 0;

  const handlers = createPipelineStageHandlers({
    flags: {
      syncEnqueueEnabled: true,
      draftWritebackEnabled: false,
      applyLabelsEnabled: false
    },
    deps: {
      async runSyncMailbox() {
        return {
          startHistoryId: "0",
          nextHistoryId: "0",
          changes: [],
          mode: "bootstrap"
        };
      },
      async commitCursor() {},
      async fetchThread() {
        return createThread("thread-1");
      },
      async upsertThreadDraft() {
        upsertCalls += 1;
        return { action: "created" };
      },
      async ensureLabels() {
        return {
          labelIdsByKey: {
            ai_drafted: "lbl-1" as LabelId,
            ai_needs_review: "lbl-2" as LabelId,
            ai_blocked: "lbl-3" as LabelId
          }
        };
      },
      async setThreadStateLabels() {},
      async enqueueStage() {}
    }
  });

  const result = await handlers.handleWriteback({
    tenantId: "tenant-1",
    mailboxId: "mailbox-1",
    userId: "me",
    threadId: "thread-1",
    triggeringMessageId: "msg-2",
    thread: createThread("thread-1"),
    subject: "Re: Trip details",
    bodyText: "Holding reply",
    idempotencyKey: "tenant-1:mailbox-1:msg-2",
    triageDecision: {
      state: "drafted",
      reasonCode: "OK_DRAFTED"
    }
  });

  assert.equal(upsertCalls, 0);
  assert.equal(result.state, "drafted");
  assert.equal(result.reasonCode, "OK_DRAFTED");
});

test("writeback stage caches ensured labels per tenant/mailbox/user", async () => {
  let ensureCalls = 0;

  const handlers = createPipelineStageHandlers({
    flags: {
      syncEnqueueEnabled: true,
      draftWritebackEnabled: false,
      applyLabelsEnabled: true
    },
    deps: {
      async runSyncMailbox() {
        return {
          startHistoryId: "0",
          nextHistoryId: "0",
          changes: [],
          mode: "bootstrap"
        };
      },
      async commitCursor() {},
      async fetchThread() {
        return createThread("thread-1");
      },
      async upsertThreadDraft() {
        return { action: "created" };
      },
      async ensureLabels() {
        ensureCalls += 1;
        return {
          labelIdsByKey: {
            ai_drafted: "lbl-1" as LabelId,
            ai_needs_review: "lbl-2" as LabelId,
            ai_blocked: "lbl-3" as LabelId
          }
        };
      },
      async setThreadStateLabels() {},
      async enqueueStage() {}
    }
  });

  const payload = {
    tenantId: "tenant-1",
    mailboxId: "mailbox-1",
    userId: "me",
    thread: createThread("thread-1"),
    subject: "Re: Trip details",
    bodyText: "Holding reply",
    idempotencyKey: "tenant-1:mailbox-1:msg-2",
    triageDecision: {
      state: "drafted" as const,
      reasonCode: "OK_DRAFTED" as const
    }
  };

  await handlers.handleWriteback({
    ...payload,
    threadId: "thread-1",
    triggeringMessageId: "msg-2"
  });
  await handlers.handleWriteback({
    ...payload,
    threadId: "thread-2",
    triggeringMessageId: "msg-3"
  });

  assert.equal(ensureCalls, 1);
});
