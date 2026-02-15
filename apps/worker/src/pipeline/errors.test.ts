import assert from "node:assert/strict";
import test from "node:test";
import {
  DraftOwnershipMismatchError,
  GmailHistoryExpiredError,
  MissingRecipientError
} from "../../../../packages/mail-gmail/src/errors.js";
import { isPermanentError, serializeError } from "./errors";

test("isPermanentError classifies known permanent errors", () => {
  assert.equal(isPermanentError(new MissingRecipientError({ threadId: "t-1" })), true);
  assert.equal(
    isPermanentError(new GmailHistoryExpiredError({ userId: "me", startHistoryId: "100" })),
    true
  );
  assert.equal(isPermanentError(new DraftOwnershipMismatchError({ draftId: "d-1" })), true);
});

test("isPermanentError classifies known transient errors", () => {
  const timeoutError = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
  const rateLimitError = Object.assign(new Error("rate limit exceeded"), { statusCode: 429 });
  assert.equal(isPermanentError(timeoutError), false);
  assert.equal(isPermanentError(rateLimitError), false);
});

test("serializeError truncates long fields safely", () => {
  const longMessage = "x".repeat(700);
  const longStack = "s".repeat(2500);
  const error = new Error(longMessage);
  error.stack = longStack;

  const serialized = serializeError(error);
  assert.equal(serialized.name, "Error");
  assert.ok(serialized.message.length <= 501);
  assert.ok((serialized.stack?.length ?? 0) <= 2001);
});
