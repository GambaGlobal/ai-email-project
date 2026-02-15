import assert from "node:assert/strict";
import test from "node:test";
import type { MailChange, MessageId, ThreadId } from "@ai-email/shared";
import { MemoryCursorStore, syncMailbox, type MailboxSyncProvider } from "./mailbox-sync";

function createMessageAddedChange(id: string, threadId: string): MailChange {
  return {
    kind: "messageAdded",
    messageId: id as MessageId,
    threadId: threadId as ThreadId
  };
}

test("syncMailbox is deterministic when commitCursor=false", async () => {
  const cursorStore = new MemoryCursorStore();
  await cursorStore.set("tenant-1", "mailbox-1", "100");

  const changes = [createMessageAddedChange("m-1", "t-1"), createMessageAddedChange("m-2", "t-2")];
  const provider: MailboxSyncProvider = {
    async listChanges() {
      return {
        nextHistoryId: "101",
        changes
      };
    },
    async getBaselineHistoryId() {
      return "100";
    }
  };

  const first = await syncMailbox({
    cursorStore,
    provider,
    request: {
      tenantId: "tenant-1",
      mailboxId: "mailbox-1",
      commitCursor: false
    }
  });
  const second = await syncMailbox({
    cursorStore,
    provider,
    request: {
      tenantId: "tenant-1",
      mailboxId: "mailbox-1",
      commitCursor: false
    }
  });

  assert.deepEqual(first, second);
  assert.equal(await cursorStore.get("tenant-1", "mailbox-1"), "100");
});

test("syncMailbox commits cursor only when commitCursor=true", async () => {
  const cursorStore = new MemoryCursorStore();
  await cursorStore.set("tenant-1", "mailbox-1", "200");

  const provider: MailboxSyncProvider = {
    async listChanges() {
      return {
        nextHistoryId: "220",
        changes: [createMessageAddedChange("m-9", "t-9")]
      };
    },
    async getBaselineHistoryId() {
      return "200";
    }
  };

  await syncMailbox({
    cursorStore,
    provider,
    request: {
      tenantId: "tenant-1",
      mailboxId: "mailbox-1",
      commitCursor: true
    }
  });

  assert.equal(await cursorStore.get("tenant-1", "mailbox-1"), "220");
});
