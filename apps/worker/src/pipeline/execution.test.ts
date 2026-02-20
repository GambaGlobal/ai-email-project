import assert from "node:assert/strict";
import test from "node:test";
import { UnrecoverableError } from "bullmq";
import { MissingRecipientError } from "../../../../packages/mail-gmail/src/errors.js";
import { runStageWithDlq } from "./execution";
import type { DlqStore } from "./dlq";

test("runStageWithDlq sends permanent errors to DLQ and discards job", async () => {
  const enqueued: unknown[] = [];
  let discarded = false;

  const dlqStore: DlqStore = {
    async enqueue(input) {
      enqueued.push(input);
      return {
        ...input,
        dlqId: "dlq-1",
        createdAt: new Date().toISOString(),
        replayCount: 0
      };
    },
    async list() {
      return [];
    },
    async markReplayed() {}
  };

  await assert.rejects(
    runStageWithDlq({
      stage: "writeback",
      payload: {
        tenantId: "tenant-1",
        mailboxId: "mailbox-1",
        threadId: "thread-1",
        triggeringMessageId: "msg-1"
      },
      job: {
        discard() {
          discarded = true;
        }
      },
      dlqStore,
      run: async () => {
        throw new MissingRecipientError({ threadId: "thread-1" });
      }
    }),
    (error: unknown) => error instanceof UnrecoverableError
  );

  assert.equal(discarded, true);
  assert.equal(enqueued.length, 1);
  assert.equal((enqueued[0] as { reasonCode: string }).reasonCode, "MISSING_RECIPIENT");
});

test("runStageWithDlq rethrows transient errors without DLQ", async () => {
  const enqueued: unknown[] = [];
  let discarded = false;

  const dlqStore: DlqStore = {
    async enqueue(input) {
      enqueued.push(input);
      return {
        ...input,
        dlqId: "dlq-1",
        createdAt: new Date().toISOString(),
        replayCount: 0
      };
    },
    async list() {
      return [];
    },
    async markReplayed() {}
  };

  const transient = Object.assign(new Error("timeout while calling provider"), {
    code: "ETIMEDOUT"
  });

  await assert.rejects(
    runStageWithDlq({
      stage: "fetch_thread",
      payload: {
        tenantId: "tenant-1",
        mailboxId: "mailbox-1",
        threadId: "thread-1",
        triggeringMessageId: "msg-1"
      },
      job: {
        discard() {
          discarded = true;
        }
      },
      dlqStore,
      run: async () => {
        throw transient;
      }
    }),
    (error: unknown) => error === transient
  );

  assert.equal(discarded, false);
  assert.equal(enqueued.length, 0);
});
