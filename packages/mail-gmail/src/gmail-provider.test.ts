import assert from "node:assert/strict";
import test from "node:test";
import type {
  CopilotDraftMarker,
  Cursor,
  MailboxId,
  MailProviderContext,
  MessageId,
  ThreadId
} from "@ai-email/shared";
import { GmailProvider } from "./gmail-provider";
import { GmailHistoryExpiredError, MissingRecipientError } from "./errors";

const context: MailProviderContext<{ accessToken: string; userId: string }> = {
  mailboxId: "mailbox-test" as MailboxId,
  provider: "gmail",
  auth: {
    accessToken: "token-test",
    userId: "me"
  }
};

const marker: CopilotDraftMarker = {
  draftKey: "tenant-1:mailbox-test:msg-1",
  version: 1
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
      },
      async listDrafts() {
        return { drafts: [] };
      },
      async getDraft() {
        return { id: "draft-0", message: { threadId: "thread-0", raw: "" } };
      },
      async createDraft() {
        return { id: "draft-created", message: { threadId: "thread-0" } };
      },
      async updateDraft() {
        return { id: "draft-updated", message: { threadId: "thread-0" } };
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
      },
      async listDrafts() {
        return { drafts: [] };
      },
      async getDraft() {
        return { id: "draft-0", message: { threadId: "thread-0", raw: "" } };
      },
      async createDraft() {
        return { id: "draft-created", message: { threadId: "thread-0" } };
      },
      async updateDraft() {
        return { id: "draft-updated", message: { threadId: "thread-0" } };
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
      },
      async listDrafts() {
        return { drafts: [] };
      },
      async getDraft() {
        return { id: "draft-0", message: { threadId: "thread-0", raw: "" } };
      },
      async createDraft() {
        return { id: "draft-created", message: { threadId: "thread-0" } };
      },
      async updateDraft() {
        return { id: "draft-updated", message: { threadId: "thread-0" } };
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

test("GmailProvider.upsertThreadDraft creates draft when marker match is absent", async () => {
  let createRaw = "";
  let createThreadId = "";
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
          id: "thread-upsert",
          messages: [
            {
              id: "m-1",
              threadId: "thread-upsert",
              internalDate: "10",
              payload: {
                headers: [
                  { name: "From", value: "guest@example.com" },
                  { name: "Subject", value: "Need help" }
                ]
              }
            }
          ]
        };
      },
      async listDrafts() {
        return {
          drafts: [{ id: "draft-other", message: { threadId: "thread-upsert" } }]
        };
      },
      async getDraft() {
        return {
          id: "draft-other",
          message: {
            threadId: "thread-upsert",
            raw: Buffer.from("Subject: Re: Need help\r\n\r\nnot ours", "utf8")
              .toString("base64")
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=+$/g, "")
          }
        };
      },
      async createDraft(input) {
        createRaw = input.raw;
        createThreadId = input.threadId;
        return { id: "draft-created", message: { threadId: input.threadId } };
      },
      async updateDraft() {
        assert.fail("updateDraft should not be called in create path");
      }
    }
  });

  const result = await provider.upsertThreadDraft(context, {
    threadId: "thread-upsert" as ThreadId,
    kind: "copilot_reply",
    replyToMessageId: "msg-trigger" as MessageId,
    body: { text: "Draft reply" },
    marker
  });

  assert.equal(result.action, "created");
  assert.equal(createThreadId, "thread-upsert");
  const decoded = Buffer.from(
    createRaw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(createRaw.length / 4) * 4, "="),
    "base64"
  ).toString("utf8");
  assert.match(decoded, /ai-email:draft:v1/);
  assert.match(decoded, /key=tenant-1:mailbox-test:msg-1/);
});

test("GmailProvider.upsertThreadDraft updates only matching marker draft", async () => {
  let updatedDraftId = "";
  let createCalled = false;
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
          id: "thread-upsert",
          messages: [
            {
              id: "m-1",
              threadId: "thread-upsert",
              internalDate: "10",
              payload: {
                headers: [{ name: "From", value: "guest@example.com" }]
              }
            }
          ]
        };
      },
      async listDrafts() {
        return {
          drafts: [
            { id: "draft-unrelated", message: { threadId: "thread-upsert" } },
            { id: "draft-owned", message: { threadId: "thread-upsert" } }
          ]
        };
      },
      async getDraft(input) {
        if (input.draftId === "draft-unrelated") {
          return {
            id: "draft-unrelated",
            message: {
              threadId: "thread-upsert",
              raw: Buffer.from("Subject: Re\r\n\r\nhello", "utf8")
                .toString("base64")
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/g, "")
            }
          };
        }
        return {
          id: "draft-owned",
          message: {
            threadId: "thread-upsert",
            raw: Buffer.from(
              "<!-- ai-email:draft:v1 key=tenant-1:mailbox-test:msg-1 mailbox=mailbox-test -->\nbody",
              "utf8"
            )
              .toString("base64")
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=+$/g, "")
          }
        };
      },
      async createDraft() {
        createCalled = true;
        return { id: "draft-created", message: { threadId: "thread-upsert" } };
      },
      async updateDraft(input) {
        updatedDraftId = input.draftId;
        return { id: input.draftId, message: { threadId: input.threadId } };
      }
    }
  });

  const result = await provider.upsertThreadDraft(context, {
    threadId: "thread-upsert" as ThreadId,
    kind: "copilot_reply",
    replyToMessageId: "msg-trigger" as MessageId,
    body: { text: "Draft reply" },
    marker
  });

  assert.equal(createCalled, false);
  assert.equal(updatedDraftId, "draft-owned");
  assert.equal(result.action, "updated");
});

test("GmailProvider.upsertThreadDraft throws MissingRecipientError when no recipient can be derived", async () => {
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
          id: "thread-upsert",
          messages: [
            {
              id: "m-1",
              threadId: "thread-upsert",
              internalDate: "10",
              payload: {
                headers: []
              }
            }
          ]
        };
      },
      async listDrafts() {
        return { drafts: [] };
      },
      async getDraft() {
        return { id: "draft-0", message: { threadId: "thread-upsert", raw: "" } };
      },
      async createDraft() {
        return { id: "draft-created", message: { threadId: "thread-upsert" } };
      },
      async updateDraft() {
        return { id: "draft-updated", message: { threadId: "thread-upsert" } };
      }
    }
  });

  await assert.rejects(
    () =>
      provider.upsertThreadDraft(context, {
        threadId: "thread-upsert" as ThreadId,
        kind: "copilot_reply",
        replyToMessageId: "msg-trigger" as MessageId,
        body: { text: "Draft reply" },
        marker
      }),
    (error: unknown) => {
      assert.ok(error instanceof MissingRecipientError);
      return true;
    }
  );
});

test("GmailProvider.ensureLabels creates missing labels and reuses existing by case-insensitive name", async () => {
  const created: string[] = [];
  const provider = new GmailProvider({
    apiClient: {
      async listLabels() {
        return {
          labels: [{ id: "lbl-drafted", name: "ai drafted" }]
        };
      },
      async createLabel(input) {
        created.push(input.name);
        return {
          id: input.name === "AI Needs Review" ? "lbl-needs" : "lbl-blocked",
          name: input.name
        };
      }
    }
  });

  const result = await provider.ensureLabels(context, {
    labels: [
      { key: "ai_drafted", name: "AI Drafted" },
      { key: "ai_needs_review", name: "AI Needs Review" },
      { key: "ai_blocked", name: "AI Blocked" }
    ]
  });

  assert.equal(String(result.labelIdsByKey.ai_drafted), "lbl-drafted");
  assert.equal(String(result.labelIdsByKey.ai_needs_review), "lbl-needs");
  assert.equal(String(result.labelIdsByKey.ai_blocked), "lbl-blocked");
  assert.deepEqual(created, ["AI Needs Review", "AI Blocked"]);
});

test("GmailProvider.setThreadStateLabels adds desired state label and removes others", async () => {
  const modifyCalls: Array<{ addLabelIds?: string[]; removeLabelIds?: string[] }> = [];
  const provider = new GmailProvider({
    apiClient: {
      async modifyThreadLabels(input) {
        modifyCalls.push({
          addLabelIds: input.addLabelIds,
          removeLabelIds: input.removeLabelIds
        });
      }
    }
  });

  await provider.setThreadStateLabels(context, {
    threadId: "thread-state" as ThreadId,
    state: "drafted",
    labelIdsByKey: {
      ai_drafted: "lbl-drafted" as never,
      ai_needs_review: "lbl-needs" as never,
      ai_blocked: "lbl-blocked" as never
    }
  });
  await provider.setThreadStateLabels(context, {
    threadId: "thread-state" as ThreadId,
    state: "drafted",
    labelIdsByKey: {
      ai_drafted: "lbl-drafted" as never,
      ai_needs_review: "lbl-needs" as never,
      ai_blocked: "lbl-blocked" as never
    }
  });

  assert.deepEqual(modifyCalls, [
    {
      addLabelIds: ["lbl-drafted"],
      removeLabelIds: ["lbl-needs", "lbl-blocked"]
    },
    {
      addLabelIds: ["lbl-drafted"],
      removeLabelIds: ["lbl-needs", "lbl-blocked"]
    }
  ]);
});
