import {
  DraftOwnershipMismatchError,
  GmailHistoryExpiredError,
  MissingRecipientError
} from "../../../../packages/mail-gmail/src/errors.js";
import type { ThreadStateReasonCode } from "@ai-email/shared";

const MAX_MESSAGE_CHARS = 500;
const MAX_STACK_CHARS = 2000;

export type SerializedError = {
  name: string;
  message: string;
  code?: string;
  stack?: string;
};

function truncate(value: string | undefined, maxChars: number): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown };
    return {
      name: error.name,
      message: truncate(error.message, MAX_MESSAGE_CHARS) ?? "Unknown error",
      code: typeof withCode.code === "string" ? withCode.code : undefined,
      stack: truncate(error.stack, MAX_STACK_CHARS)
    };
  }

  return {
    name: "UnknownError",
    message: truncate(String(error), MAX_MESSAGE_CHARS) ?? "Unknown error"
  };
}

function hasPermanentFlag(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const withFlag = error as { permanent?: unknown };
  return withFlag.permanent === true;
}

function hasTransientSignal(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const withCode = error as { code?: unknown; message?: unknown; statusCode?: unknown };
  const code = typeof withCode.code === "string" ? withCode.code.toUpperCase() : "";
  const message = typeof withCode.message === "string" ? withCode.message.toLowerCase() : "";
  const statusCode = typeof withCode.statusCode === "number" ? withCode.statusCode : undefined;

  if (statusCode && (statusCode === 429 || statusCode >= 500)) {
    return true;
  }

  if (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }

  return message.includes("timeout") || message.includes("rate limit") || message.includes("temporarily unavailable");
}

export function isPermanentError(error: unknown): boolean {
  if (
    error instanceof MissingRecipientError ||
    error instanceof GmailHistoryExpiredError ||
    error instanceof DraftOwnershipMismatchError
  ) {
    return true;
  }

  if (hasPermanentFlag(error)) {
    return true;
  }

  if (error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError) {
    return true;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("missing required field") ||
      message.includes("not configured") ||
      message.includes("must be") ||
      message.includes("invalid")
    ) {
      return true;
    }
  }

  if (hasTransientSignal(error)) {
    return false;
  }

  return false;
}

export function toDlqReasonCode(error: unknown, defaultReasonCode: ThreadStateReasonCode = "PROVIDER_ERROR") {
  if (error instanceof MissingRecipientError) {
    return "MISSING_RECIPIENT" as const;
  }
  return defaultReasonCode;
}
