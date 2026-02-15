import assert from "node:assert/strict";
import test from "node:test";
import type { Cursor, MailboxId, MailProviderContext, ThreadId } from "@ai-email/shared";
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
      },
      async getThread() {
        return { id: "thread-0", messages: [] };
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
      },
      async getThread() {
        return { id: "thread-0", messages: [] };
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

test("GmailProvider.getThread normalizes ordering, addresses, and body extraction", async () => {
  const provider = new GmailProvider({
    apiClient: {
      async listHistory() {
        return { historyId: "0", history: [] };
      },
      async getProfile() {
        return { historyId: "0" };
      },
      async getThread() {
        return {
          id: "thread-abc",
          messages: [
            {
              id: "m-2",
              threadId: "thread-abc",
              internalDate: "200",
              snippet: "Second",
              payload: {
                headers: [
                  { name: "Subject", value: "Trip Details" },
                  { name: "From", value: "Guide Team <Guide@Example.com>" },
                  { name: "To", value: "Guest One <guest@example.com>, second@example.com" },
                  { name: "Cc", value: "Ops <ops@example.com>" }
                ],
                mimeType: "multipart/alternative",
                parts: [
                  {
                    mimeType: "text/plain",
                    body: {
                      data: Buffer.from("Plain body", "utf8")
                        .toString("base64")
                        .replace(/\+/g, "-")
                        .replace(/\//g, "_")
                        .replace(/=+$/g, "")
                    }
                  }
                ]
              }
            },
            {
              id: "m-1",
              threadId: "thread-abc",
              internalDate: "100",
              snippet: "First",
              payload: {
                headers: [
                  { name: "From", value: "guest@example.com" },
                  { name: "To", value: "guide@example.com" }
                ],
                mimeType: "text/html",
                body: {
                  data: Buffer.from("<p>Hello <b>team</b></p>", "utf8")
                    .toString("base64")
                    .replace(/\+/g, "-")
                    .replace(/\//g, "_")
                    .replace(/=+$/g, "")
                }
              }
            }
          ]
        };
      }
    }
  });

  const response = await provider.getThread(context, { threadId: "thread-abc" as ThreadId });
  assert.equal(response.thread.threadId, "thread-abc");
  assert.equal(response.thread.lastUpdatedMs, 200);
  assert.deepEqual(
    response.thread.messages.map((message) => message.messageId),
    ["m-1", "m-2"]
  );
  assert.equal(response.thread.messages[0].bodyText, "Hello team");
  assert.equal(response.thread.messages[1].bodyText, "Plain body");
  assert.equal(response.thread.subject, "Trip Details");
  assert.deepEqual(
    response.thread.participants.map((participant) => participant.email),
    ["guest@example.com", "guide@example.com", "second@example.com", "ops@example.com"]
  );
});
