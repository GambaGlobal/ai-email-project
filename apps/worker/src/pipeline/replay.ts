import { makePipelineJobId } from "./stages.js";
import type { DlqStore } from "./dlq.js";
import type { PipelineStagePayloadMap, QueueTargetStage } from "./types.js";

export type DlqReplayFilters = {
  tenantId?: string;
  stage?: QueueTargetStage | "mailbox_sync";
  limit: number;
};

export type DlqReplayResult = {
  scanned: number;
  replayed: number;
};

export async function replayDlqItems(input: {
  dlqStore: DlqStore;
  filters: DlqReplayFilters;
  enqueueStage: <TStage extends QueueTargetStage>(request: {
    stage: TStage;
    payload: PipelineStagePayloadMap[TStage];
    jobId: string;
  }) => Promise<void>;
}): Promise<DlqReplayResult> {
  const entries = await input.dlqStore.list({
    limit: input.filters.limit,
    filters: {
      tenantId: input.filters.tenantId,
      stage: input.filters.stage
    }
  });

  let replayed = 0;

  for (const entry of entries) {
    if (entry.stage === "mailbox_sync") {
      continue;
    }

    const stage = entry.stage;
    const payload = entry.originalPayload as PipelineStagePayloadMap[typeof stage];
    if (!payload || typeof payload !== "object") {
      continue;
    }

    const context = payload as {
      tenantId: string;
      mailboxId: string;
      threadId: string;
      triggeringMessageId: string;
    };

    await input.enqueueStage({
      stage,
      payload,
      jobId: makePipelineJobId(stage, {
        tenantId: context.tenantId,
        mailboxId: context.mailboxId,
        threadId: context.threadId,
        triggeringMessageId: context.triggeringMessageId
      })
    });
    await input.dlqStore.markReplayed(entry.dlqId);
    replayed += 1;
  }

  return {
    scanned: entries.length,
    replayed
  };
}
