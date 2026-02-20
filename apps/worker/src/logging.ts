import type { CorrelationId } from "@ai-email/shared";

export type StructuredLogContext = {
  tenantId?: string;
  mailboxId?: string;
  provider?: string;
  stage?: string;
  queueName?: string;
  jobId?: string;
  correlationId?: CorrelationId;
  causationId?: string;
  threadId?: string;
  messageId?: string;
  gmailHistoryId?: string;
};

export type StructuredLogEvent = StructuredLogContext & {
  event: string;
  elapsedMs?: number;
  startedAt?: string;
  attempt?: number;
  maxAttempts?: number;
  errorClass?: string;
  errorCode?: string;
  errorMessage?: string;
  errorStack?: string;
};

export function toStructuredLogContext(context: StructuredLogContext): StructuredLogContext {
  return {
    tenantId: context.tenantId,
    mailboxId: context.mailboxId,
    provider: context.provider,
    stage: context.stage,
    queueName: context.queueName,
    jobId: context.jobId,
    correlationId: context.correlationId,
    causationId: context.causationId,
    threadId: context.threadId,
    messageId: context.messageId,
    gmailHistoryId: context.gmailHistoryId
  };
}

export function toStructuredLogEvent(
  context: StructuredLogContext,
  event: string,
  extra?: {
    elapsedMs?: number;
    startedAt?: string;
    attempt?: number;
    maxAttempts?: number;
    errorClass?: string;
    errorCode?: string;
    errorMessage?: string;
    errorStack?: string;
  }
): StructuredLogEvent {
  return {
    ...toStructuredLogContext(context),
    event,
    elapsedMs: extra?.elapsedMs,
    startedAt: extra?.startedAt,
    attempt: extra?.attempt,
    maxAttempts: extra?.maxAttempts,
    errorClass: extra?.errorClass,
    errorCode: extra?.errorCode,
    errorMessage: extra?.errorMessage,
    errorStack: extra?.errorStack
  };
}

export function toLogError(error: unknown): { message: string; stack?: string; code?: string } {
  if (error instanceof Error) {
    const maybeCode = (error as { code?: unknown }).code;
    return {
      message: error.message,
      stack: error.stack,
      code: typeof maybeCode === "string" ? maybeCode : undefined
    };
  }

  return {
    message: String(error)
  };
}
