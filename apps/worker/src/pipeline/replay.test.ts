import assert from "node:assert/strict";
import test from "node:test";
import { replayDlqItems } from "./replay";
import type { DlqStore, DlqItemPayload } from "./dlq";

test("replayDlqItems enqueues deterministic stage jobs and marks replayed", async () => {
  const marked: string[] = [];
  const enqueued: Array<{ stage: string; jobId: string }> = [];

  const item: DlqItemPayload = {
    dlqId: "dlq-1",
    createdAt: new Date().toISOString(),
    occurredAt: new Date().toISOString(),
    replayCount: 0,
    stage: "fetch_thread",
    tenantId: "tenant-1",
    mailboxId: "mailbox-1",
    userId: "me",
    threadId: "thread-1",
    triggeringMessageId: "msg-1",
    state: "needs_review",
    reasonCode: "PROVIDER_ERROR",
    error: {
      name: "Error",
      message: "boom"
    },
    originalPayload: {
      tenantId: "tenant-1",
      mailboxId: "mailbox-1",
      userId: "me",
      threadId: "thread-1",
      triggeringMessageId: "msg-1"
    }
  };

  const dlqStore: DlqStore = {
    async enqueue(input) {
      return {
        ...input,
        dlqId: "new",
        createdAt: new Date().toISOString(),
        replayCount: 0
      };
    },
    async list() {
      return [item];
    },
    async markReplayed(dlqId) {
      marked.push(dlqId);
    }
  };

  const result = await replayDlqItems({
    dlqStore,
    filters: {
      limit: 10
    },
    enqueueStage: async ({ stage, jobId }) => {
      enqueued.push({ stage, jobId });
    }
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.replayed, 1);
  assert.deepEqual(marked, ["dlq-1"]);
  assert.deepEqual(enqueued, [
    {
      stage: "fetch_thread",
      jobId: "fetch_thread:tenant-1:mailbox-1:thread-1:msg-1"
    }
  ]);
});

test("replayDlqItems skips mailbox_sync entries", async () => {
  const item: DlqItemPayload = {
    dlqId: "dlq-2",
    createdAt: new Date().toISOString(),
    occurredAt: new Date().toISOString(),
    replayCount: 0,
    stage: "mailbox_sync",
    tenantId: "tenant-1",
    mailboxId: "mailbox-1",
    state: "blocked",
    reasonCode: "PROVIDER_ERROR",
    error: {
      name: "Error",
      message: "boom"
    },
    originalPayload: {
      tenantId: "tenant-1",
      mailboxId: "mailbox-1"
    }
  };

  let marked = false;
  let enqueued = false;

  const dlqStore: DlqStore = {
    async enqueue(input) {
      return {
        ...input,
        dlqId: "new",
        createdAt: new Date().toISOString(),
        replayCount: 0
      };
    },
    async list() {
      return [item];
    },
    async markReplayed() {
      marked = true;
    }
  };

  const result = await replayDlqItems({
    dlqStore,
    filters: {
      limit: 10
    },
    enqueueStage: async () => {
      enqueued = true;
    }
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.replayed, 0);
  assert.equal(marked, false);
  assert.equal(enqueued, false);
});
