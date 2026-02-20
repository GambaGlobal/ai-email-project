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
  pubsubDeliveryId?: string;
  pubsubMessageId?: string;
  pubsubSubscription?: string;
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
    pubsubDeliveryId?: string;
    pubsubMessageId?: string;
    pubsubSubscription?: string;
  }
): StructuredLogEvent {
  return {
    ...toStructuredLogContext(context),
    event,
    elapsedMs: extra?.elapsedMs,
    pubsubDeliveryId: extra?.pubsubDeliveryId,
    pubsubMessageId: extra?.pubsubMessageId,
    pubsubSubscription: extra?.pubsubSubscription
  };
}

export function toPubsubIdentifiers(headers: Record<string, unknown>): {
  pubsubDeliveryId?: string;
  pubsubMessageId?: string;
  pubsubSubscription?: string;
} {
  return {
    pubsubDeliveryId:
      typeof headers["x-goog-delivery-attempt"] === "string"
        ? headers["x-goog-delivery-attempt"]
        : undefined,
    pubsubMessageId:
      typeof headers["x-goog-message-number"] === "string"
        ? headers["x-goog-message-number"]
        : undefined,
    pubsubSubscription:
      typeof headers["x-goog-subscription-name"] === "string"
        ? headers["x-goog-subscription-name"]
        : undefined
  };
}
