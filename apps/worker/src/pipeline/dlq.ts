import { randomUUID } from "node:crypto";
import type { Queue } from "bullmq";
import type { ThreadState, ThreadStateReasonCode } from "@ai-email/shared";
import type { QueueTargetStage } from "./types.js";
import type { SerializedError } from "./errors.js";

const MAX_JSON_CHARS = 8000;

type DlqStage = QueueTargetStage | "mailbox_sync";

export type DlqItemPayload = {
  dlqId: string;
  createdAt: string;
  occurredAt: string;
  replayedAt?: string;
  replayCount: number;
  stage: DlqStage;
  tenantId: string;
  mailboxId: string;
  userId?: string;
  threadId?: string;
  triggeringMessageId?: string;
  state: ThreadState;
  reasonCode: ThreadStateReasonCode;
  error: SerializedError;
  originalPayload: unknown;
};

export type DlqListFilters = {
  tenantId?: string;
  stage?: DlqStage;
};

export interface DlqStore {
  enqueue(input: Omit<DlqItemPayload, "dlqId" | "createdAt" | "replayCount">): Promise<DlqItemPayload>;
  list(input: { limit: number; filters?: DlqListFilters }): Promise<DlqItemPayload[]>;
  markReplayed(dlqId: string): Promise<void>;
}

function safeClonePayload(payload: unknown): unknown {
  try {
    const json = JSON.stringify(payload);
    if (!json) {
      return null;
    }
    if (json.length <= MAX_JSON_CHARS) {
      return JSON.parse(json) as unknown;
    }
    return {
      truncated: true,
      preview: `${json.slice(0, MAX_JSON_CHARS)}…`
    };
  } catch {
    return {
      truncated: true,
      preview: "[unserializable payload]"
    };
  }
}

export class BullMqDlqStore implements DlqStore {
  private readonly queue: Queue<DlqItemPayload>;

  constructor(queue: Queue<DlqItemPayload>) {
    this.queue = queue;
  }

  async enqueue(input: Omit<DlqItemPayload, "dlqId" | "createdAt" | "replayCount">): Promise<DlqItemPayload> {
    const now = new Date().toISOString();
    const dlqId = randomUUID();
    const payload: DlqItemPayload = {
      ...input,
      originalPayload: safeClonePayload(input.originalPayload),
      dlqId,
      createdAt: now,
      replayCount: 0
    };

    const baseJobKey = `${payload.stage}:${payload.tenantId}:${payload.mailboxId}:${payload.threadId ?? "none"}:${payload.triggeringMessageId ?? "none"}`;
    await this.queue.add("dlq_item", payload, {
      jobId: `${baseJobKey}:${Date.now()}`,
      removeOnComplete: false,
      removeOnFail: false,
      attempts: 1
    });

    return payload;
  }

  async list(input: { limit: number; filters?: DlqListFilters }): Promise<DlqItemPayload[]> {
    const jobs = await this.queue.getJobs(["waiting", "delayed", "prioritized"], 0, Math.max(input.limit * 5, input.limit));
    const filtered = jobs
      .map((job) => job.data)
      .filter((item) => !item.replayedAt)
      .filter((item) => !input.filters?.tenantId || item.tenantId === input.filters.tenantId)
      .filter((item) => !input.filters?.stage || item.stage === input.filters.stage)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    return filtered.slice(0, input.limit);
  }

  async markReplayed(dlqId: string): Promise<void> {
    const jobs = await this.queue.getJobs(["waiting", "delayed", "prioritized"], 0, 500);
    const matching = jobs.find((job) => job.data.dlqId === dlqId);
    if (!matching) {
      return;
    }

    await matching.updateData({
      ...matching.data,
      replayCount: (matching.data.replayCount ?? 0) + 1,
      replayedAt: new Date().toISOString()
    });
  }
}
