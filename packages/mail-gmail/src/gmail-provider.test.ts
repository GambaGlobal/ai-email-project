import assert from "node:assert/strict";
import test from "node:test";
import type { Cursor, MailboxId, MailProviderContext } from "@ai-email/shared";
import { GmailProvider } from "./gmail-provider";
import { GmailHistoryExpiredError } from "./errors";

const context: MailProviderContext<{ accessToken: string; userId: string }> = {
  mailboxId: "mailbox-test" as MailboxId,
  provider: "gmail",
  auth: {
    accessToken: "token-test",
    userId: "me"
  }
};

test("GmailProvider.listChanges paginates, dedupes, sorts, and returns next cursor", async () => {
  const provider = new GmailProvider({
    apiClient: {
      async listHistory(input) {
        if (!input.pageToken) {
          return {
            historyId: "120",
            nextPageToken: "page-2",
            history: [
              {
                messagesAdded: [
                  {
                    message: {
                      id: "msg-b",
                      threadId: "thr-2",
                      internalDate: "200"
                    }
                  }
                ]
              }
            ]
          };
        }
        return {
          historyId: "121",
          history: [
            {
              labelsAdded: [
                {
                  message: {
                    id: "msg-a",
                    threadId: "thr-1",
                    internalDate: "100"
                  }
                },
                {
                  message: {
                    id: "msg-b",
                    threadId: "thr-2",
                    internalDate: "200"
                  }
                }
              ]
            }
          ]
        };
      },
      async getProfile() {
        return { historyId: "0" };
      }
    }
  });

  const response = await provider.listChanges(context, { cursor: "101" as Cursor });
  assert.equal(String(response.nextCursor), "121");
  assert.deepEqual(
    response.changes.map((item) => ({
      kind: item.kind,
      messageId: "messageId" in item ? item.messageId : null,
      threadId: "threadId" in item ? item.threadId : null
    })),
    [
      { kind: "messageAdded", messageId: "msg-a", threadId: "thr-1" },
      { kind: "messageAdded", messageId: "msg-b", threadId: "thr-2" }
    ]
  );
});

test("GmailProvider.listChanges maps history expired into typed error", async () => {
  const provider = new GmailProvider({
    apiClient: {
      async listHistory() {
        const error = new Error("History not found");
        (error as Error & { statusCode?: number }).statusCode = 404;
        throw error;
      },
      async getProfile() {
        return { historyId: "0" };
      }
    }
  });

  await assert.rejects(
    () => provider.listChanges(context, { cursor: "999" as Cursor }),
    (error: unknown) => {
      assert.ok(error instanceof GmailHistoryExpiredError);
      assert.equal(error.startHistoryId, "999");
      assert.equal(error.userId, "me");
      return true;
    }
  );
});
