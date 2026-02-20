import assert from "node:assert/strict";
import test from "node:test";
import type { MailChange, MessageId, NormalizedThread, ThreadId } from "@ai-email/shared";
import { collectThreadContextsForChanges } from "./mailbox-sync";

function threadChange(threadId: string, messageId: string): MailChange {
  return {
    kind: "messageAdded",
    threadId: threadId as ThreadId,
    messageId: messageId as MessageId
  };
}

test("collectThreadContextsForChanges dedupes thread ids and returns deterministic order", async () => {
  const requested: string[] = [];
  const contexts = await collectThreadContextsForChanges({
    tenantId: "tenant-1",
    mailboxId: "mailbox-1",
    changes: [
      threadChange("thread-b", "msg-2"),
      threadChange("thread-a", "msg-1"),
      threadChange("thread-b", "msg-3")
    ],
    fetchThread: async ({ threadId }) => {
      requested.push(threadId);
      const thread: NormalizedThread = {
        threadId,
        participants: [],
        messages: [],
        lastUpdatedMs: 0
      };
      return thread;
    }
  });

  assert.deepEqual(requested, ["thread-a", "thread-b"]);
  assert.deepEqual(
    contexts.map((item) => item.threadId),
    ["thread-a", "thread-b"]
  );
});
