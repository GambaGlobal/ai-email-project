import assert from "node:assert/strict";
import test from "node:test";
import type { MailChange, MessageId, ThreadId } from "@ai-email/shared";
import {
  MemoryCursorStore,
  runDraftUpsertIdempotencyHarness,
  syncMailbox,
  type DraftUpsertProvider,
  type MailboxSyncProvider
} from "./mailbox-sync";

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

test("runDraftUpsertIdempotencyHarness calls provider twice with same idempotency key", async () => {
  const calls: string[] = [];
  const provider: DraftUpsertProvider = {
    async upsertThreadDraft(input) {
      calls.push(input.idempotencyKey);
      return {
        action: calls.length === 1 ? "created" : "updated",
        draftId: "draft-1" as never
      };
    }
  };

  const result = await runDraftUpsertIdempotencyHarness({
    provider,
    mailboxId: "mailbox-1" as never,
    threadId: "thread-1" as never,
    replyToMessageId: "msg-1" as never,
    idempotencyKey: "tenant-1:mailbox-1:msg-1",
    subject: "Re: Hello",
    bodyText: "Draft body"
  });

  assert.deepEqual(calls, ["tenant-1:mailbox-1:msg-1", "tenant-1:mailbox-1:msg-1"]);
  assert.equal(result.first.action, "created");
  assert.equal(result.second.action, "updated");
});
