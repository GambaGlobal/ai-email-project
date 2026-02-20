import { UnrecoverableError } from "bullmq";
import type { ThreadState, ThreadStateReasonCode } from "@ai-email/shared";
import { isPermanentError, serializeError, toDlqReasonCode } from "./errors.js";
import type { DlqStore } from "./dlq.js";
import type { QueueTargetStage } from "./types.js";

type DlqStage = QueueTargetStage | "mailbox_sync";

type StagePayloadContext = {
  tenantId?: string;
  mailboxId?: string;
  userId?: string;
  threadId?: string;
  triggeringMessageId?: string;
};

function extractContext(payload: unknown): StagePayloadContext {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const record = payload as Record<string, unknown>;
  return {
    tenantId: typeof record.tenantId === "string" ? record.tenantId : undefined,
    mailboxId: typeof record.mailboxId === "string" ? record.mailboxId : undefined,
    userId: typeof record.userId === "string" ? record.userId : undefined,
    threadId: typeof record.threadId === "string" ? record.threadId : undefined,
    triggeringMessageId:
      typeof record.triggeringMessageId === "string" ? record.triggeringMessageId : undefined
  };
}

export async function runStageWithDlq<TPayload, TResult>(input: {
  stage: DlqStage;
  payload: TPayload;
  run: () => Promise<TResult>;
  dlqStore: DlqStore;
  job: { discard: () => void };
  defaultState?: ThreadState;
  defaultReasonCode?: ThreadStateReasonCode;
}): Promise<TResult> {
  try {
    return await input.run();
  } catch (error) {
    if (!isPermanentError(error)) {
      throw error;
    }

    input.job.discard();

    const context = extractContext(input.payload);
    const serialized = serializeError(error);
    const state = input.defaultState ?? "needs_review";
    const reasonCode = toDlqReasonCode(error, input.defaultReasonCode ?? "PROVIDER_ERROR");

    await input.dlqStore.enqueue({
      occurredAt: new Date().toISOString(),
      stage: input.stage,
      tenantId: context.tenantId ?? "unknown-tenant",
      mailboxId: context.mailboxId ?? "unknown-mailbox",
      userId: context.userId,
      threadId: context.threadId,
      triggeringMessageId: context.triggeringMessageId,
      state,
      reasonCode,
      error: serialized,
      originalPayload: input.payload
    });

    throw new UnrecoverableError(serialized.message);
  }
}
