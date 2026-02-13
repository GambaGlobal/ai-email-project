export enum ErrorClass {
  TRANSIENT = "TRANSIENT",
  PERMANENT = "PERMANENT",
  IGNORE = "IGNORE"
}

export type ClassifiedError = {
  class: ErrorClass;
  reason: string;
  code?: string;
  httpStatus?: number;
};

const NODE_TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNREFUSED"
]);

const POSTGRES_TRANSIENT_SQLSTATE = new Set([
  "40001",
  "40P01",
  "53300",
  "57P01",
  "08006",
  "08001"
]);

const DUPLICATE_PATTERNS = [
  /duplicate key/i,
  /already exists/i,
  /already processed/i,
  /\bduplicate\b/i
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const candidate = value[key];
  return typeof candidate === "number" ? candidate : undefined;
}

function extractHttpStatus(value: unknown): number | undefined {
  const directStatus =
    readNumber(value, "status") ?? readNumber(value, "statusCode") ?? readNumber(value, "httpStatus");
  if (typeof directStatus === "number") {
    return directStatus;
  }

  if (!isRecord(value)) {
    return undefined;
  }
  return readNumber(value.response, "status");
}

function extractCode(value: unknown): string | undefined {
  const code = readString(value, "code") ?? readString(value, "errno");
  return code?.toUpperCase();
}

function extractMessage(value: unknown): string | undefined {
  if (value instanceof Error) {
    return value.message;
  }
  return readString(value, "message");
}

function isDuplicateLike(code: string | undefined, message: string | undefined): boolean {
  if (code === "23505") {
    return true;
  }
  if (!message) {
    return false;
  }
  return DUPLICATE_PATTERNS.some((pattern) => pattern.test(message));
}

export function classifyError(err: unknown): ClassifiedError {
  try {
    const code = extractCode(err);
    const httpStatus = extractHttpStatus(err);
    const message = extractMessage(err);

    if (isDuplicateLike(code, message)) {
      return {
        class: ErrorClass.IGNORE,
        reason: "duplicate_or_already_exists",
        code,
        httpStatus
      };
    }

    if (code && NODE_TRANSIENT_CODES.has(code)) {
      return {
        class: ErrorClass.TRANSIENT,
        reason: "network_code",
        code,
        httpStatus
      };
    }

    if (code && POSTGRES_TRANSIENT_SQLSTATE.has(code)) {
      return {
        class: ErrorClass.TRANSIENT,
        reason: "postgres_transient_sqlstate",
        code,
        httpStatus
      };
    }

    if (typeof httpStatus === "number") {
      if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
        return {
          class: ErrorClass.TRANSIENT,
          reason: "http_retryable_status",
          code,
          httpStatus
        };
      }

      if (httpStatus >= 400 && httpStatus < 500) {
        return {
          class: ErrorClass.PERMANENT,
          reason: "http_client_error",
          code,
          httpStatus
        };
      }
    }

    return {
      class: ErrorClass.PERMANENT,
      reason: "default_permanent",
      code,
      httpStatus
    };
  } catch {
    return {
      class: ErrorClass.PERMANENT,
      reason: "classification_fallback"
    };
  }
}
