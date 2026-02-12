type CorrelationId = string & { readonly __brand: "CorrelationId" };

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

export function asCorrelationId(value: string): CorrelationId {
  return value as CorrelationId;
}

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
