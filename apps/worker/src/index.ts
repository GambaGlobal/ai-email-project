import { randomUUID } from "node:crypto";
import { UnrecoverableError, Worker } from "bullmq";
import IORedis from "ioredis";
import { Pool, type PoolClient } from "pg";
import {
  DEFAULT_JOB_ATTEMPTS,
  ErrorClass,
  KILL_SWITCH_DOCS_INGESTION,
  classifyError,
  isGlobalDocsIngestionDisabled,
  type CorrelationId
} from "@ai-email/shared";
import { toLogError, toStructuredLogContext, toStructuredLogEvent } from "./logging.js";

type DocsIngestionJob = {
  tenantId: string;
  mailboxId?: string;
  provider?: string;
  stage?: string;
  correlationId: CorrelationId;
  causationId?: string;
  threadId?: string;
  messageId?: string;
  gmailHistoryId?: string;
  docId: string;
  bucket: string;
  storageKey: string;
  category: string;
};

const workerName = process.env.WORKER_NAME ?? "worker";
const docsQueueName = "docs_ingestion";
const mailNotificationsQueueName = "mail_notifications";
const mailboxSyncQueueName = "mailbox_sync";

type MailNotificationJob = {
  tenantId: string;
  mailboxId?: string | null;
  provider?: "gmail";
  stage?: "mail_notification";
  correlationId?: CorrelationId;
  messageId?: string;
  receiptId?: string;
  gmailHistoryId?: string | null;
  emailAddress?: string | null;
};

type MailboxSyncJob = {
  tenantId?: string;
  mailboxId?: string;
  provider?: "gmail";
};

type MailboxSyncStateSnapshotRow = {
  last_history_id: string;
  pending_max_history_id: string;
  last_correlation_id: string | null;
};

type MailNotificationReceiptRow = {
  id: string;
  processing_status: string;
  processed_at: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!process.env.REDIS_URL) {
  // eslint-disable-next-line no-console
  console.log("redis not configured, skipping queue init");
  // eslint-disable-next-line no-console
  console.log(`worker ready (${workerName}) at ${new Date().toISOString()}`);
  process.exit(0);
}

const redisConnection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

const dbPool = new Pool({ connectionString: process.env.DATABASE_URL });

function toSafeStack(stack: string | undefined): string | undefined {
  if (!stack) {
    return undefined;
  }
  return stack.split("\n").slice(0, 6).join("\n");
}

function truncateText(value: string | undefined, max: number): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > max ? value.slice(0, max) : value;
}

function assertRequiredString(value: unknown, fieldName: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw new Error(`Missing required field: ${fieldName}`);
}

function resolveMailboxRunCorrelationId(value: unknown): string {
  if (typeof value === "string" && UUID_PATTERN.test(value.trim())) {
    return value.trim();
  }
  return randomUUID();
}

async function fetchMailboxHistoryBoundaryStub(_input: {
  tenantId: string;
  mailboxId: string;
  provider: string;
  correlationId: string;
  fromHistoryId: string;
  toHistoryId: string;
}): Promise<{ fetchedCount: number; events: unknown[] }> {
  return {
    fetchedCount: 0,
    events: []
  };
}

async function withTenantClient<T>(tenantId: string, callback: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getTenantKillSwitchState(tenantId: string, key: string) {
  return withTenantClient(tenantId, async (client) => {
    const result = await client.query(
      `
        SELECT is_enabled, reason
        FROM tenant_kill_switches
        WHERE tenant_id = $1
          AND key = $2
      `,
      [tenantId, key]
    );

    const row = result.rows[0] as { is_enabled?: unknown; reason?: unknown } | undefined;
    return {
      isEnabled: row?.is_enabled === true,
      reason: typeof row?.reason === "string" ? row.reason : null
    };
  });
}

type IngestionTransitionResult =
  | { mode: "started" }
  | { mode: "noop"; reason: "already_processing" | "already_done" | "ignored" | "doc_not_found" | "unknown" };

async function beginDocIngestionTransition(tenantId: string, docId: string): Promise<IngestionTransitionResult> {
  return withTenantClient(tenantId, async (client) => {
    const updated = await client.query(
      `
        UPDATE docs
        SET
          status = 'indexing',
          ingestion_status = 'processing',
          ingestion_status_updated_at = now(),
          error_message = NULL,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND ingestion_status IN ('queued', 'failed')
        RETURNING id
      `,
      [tenantId, docId]
    );
    if ((updated.rowCount ?? 0) > 0) {
      return { mode: "started" };
    }

    const current = await client.query(
      `
        SELECT ingestion_status
        FROM docs
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [tenantId, docId]
    );
    const row = current.rows[0] as { ingestion_status?: unknown } | undefined;
    const status = typeof row?.ingestion_status === "string" ? row.ingestion_status : null;

    if (!status) {
      return { mode: "noop", reason: "doc_not_found" };
    }
    if (status === "processing") {
      return { mode: "noop", reason: "already_processing" };
    }
    if (status === "done") {
      return { mode: "noop", reason: "already_done" };
    }
    if (status === "ignored") {
      return { mode: "noop", reason: "ignored" };
    }

    return { mode: "noop", reason: "unknown" };
  });
}

async function markDocIgnored(tenantId: string, docId: string, reason: string) {
  await withTenantClient(tenantId, async (client) => {
    await client.query(
      `
        UPDATE docs
        SET
          status = 'failed',
          ingestion_status = 'ignored',
          ingestion_status_updated_at = now(),
          error_message = LEFT($3, 500),
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenantId, docId, reason]
    );
  });
}

const ingestionWorker = new Worker<DocsIngestionJob>(
  docsQueueName,
  async (job) => {
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    const { tenantId, docId } = job.data;
    const correlationId = job.data.correlationId;
    const baseLogContext = toStructuredLogContext({
      tenantId: job.data.tenantId,
      mailboxId: job.data.mailboxId,
      provider: job.data.provider ?? "other",
      stage: job.data.stage ?? "doc_ingestion",
      queueName: job.queueName,
      jobId: job.id?.toString(),
      correlationId,
      causationId: job.data.causationId,
      threadId: job.data.threadId,
      messageId: job.data.messageId,
      gmailHistoryId: job.data.gmailHistoryId
    });
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? DEFAULT_JOB_ATTEMPTS;

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        toStructuredLogEvent(baseLogContext, "job.start", {
          startedAt: startedAtIso,
          attempt,
          maxAttempts
        })
      )
    );

    const transition = await beginDocIngestionTransition(tenantId, docId);
    if (transition.mode === "noop") {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "job.ignored",
          reason: transition.reason,
          correlationId,
          tenantId,
          queueName: job.queueName,
          jobId: job.id?.toString(),
          attempt,
          maxAttempts
        })
      );
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          toStructuredLogEvent(baseLogContext, "job.done", {
            startedAt: startedAtIso,
            elapsedMs: Date.now() - startedAt,
            attempt,
            maxAttempts
          })
        )
      );
      return;
    }

    if (isGlobalDocsIngestionDisabled(process.env)) {
      await markDocIgnored(tenantId, docId, "Docs ingestion disabled by global kill switch");
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "job.ignored",
          reason: "kill_switch_global",
          key: KILL_SWITCH_DOCS_INGESTION,
          correlationId,
          tenantId,
          queueName: job.queueName,
          jobId: job.id?.toString(),
          attempt,
          maxAttempts
        })
      );
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          toStructuredLogEvent(baseLogContext, "job.done", {
            startedAt: startedAtIso,
            elapsedMs: Date.now() - startedAt,
            attempt,
            maxAttempts
          })
        )
      );
      return;
    }

    const tenantKillSwitch = await getTenantKillSwitchState(tenantId, KILL_SWITCH_DOCS_INGESTION);
    if (tenantKillSwitch.isEnabled) {
      await markDocIgnored(
        tenantId,
        docId,
        tenantKillSwitch.reason
          ? `Docs ingestion disabled by tenant kill switch: ${tenantKillSwitch.reason}`
          : "Docs ingestion disabled by tenant kill switch"
      );
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "job.ignored",
          reason: "kill_switch_tenant",
          key: KILL_SWITCH_DOCS_INGESTION,
          killSwitchReason: tenantKillSwitch.reason,
          correlationId,
          tenantId,
          queueName: job.queueName,
          jobId: job.id?.toString(),
          attempt,
          maxAttempts
        })
      );
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          toStructuredLogEvent(baseLogContext, "job.done", {
            startedAt: startedAtIso,
            elapsedMs: Date.now() - startedAt,
            attempt,
            maxAttempts
          })
        )
      );
      return;
    }

    try {
      // Phase 9.7 minimal ingestion hook:
      // real parse/chunk/embed/index pipeline wiring remains in later steps.
      await new Promise((resolve) => setTimeout(resolve, 700));

      await withTenantClient(tenantId, async (client) => {
        await client.query(
          `
            UPDATE docs
            SET
              status = 'ready',
              ingestion_status = 'done',
              ingestion_status_updated_at = now(),
              ingested_at = now(),
              error_message = NULL,
              indexed_at = now(),
              updated_at = now()
            WHERE tenant_id = $1
              AND id = $2
          `,
          [tenantId, docId]
        );
      });

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          toStructuredLogEvent(baseLogContext, "job.done", {
            startedAt: startedAtIso,
            elapsedMs: Date.now() - startedAt,
            attempt,
            maxAttempts
          })
        )
      );
    } catch (error) {
      const classifiedError = classifyError(error);
      const errorClass =
        classifiedError.class === ErrorClass.TRANSIENT ? ErrorClass.TRANSIENT : ErrorClass.PERMANENT;
      const structuredError = toLogError(error);
      const truncatedStack = truncateText(toSafeStack(structuredError.stack), 4000);
      const stage = job.data.stage ?? "doc_ingestion";

      try {
        await withTenantClient(tenantId, async (client) => {
          await client.query(
            `
              INSERT INTO doc_ingestion_failures (
                tenant_id,
                correlation_id,
                job_id,
                stage,
                error_class,
                error_code,
                error_message,
                error_stack,
                attempt,
                max_attempts
              )
              VALUES ($1, $2, $3, $4, $5, $6, LEFT($7, 2000), $8, $9, $10)
            `,
            [
              tenantId,
              correlationId,
              job.id?.toString() ?? "unknown",
              stage,
              errorClass,
              structuredError.code ?? classifiedError.code ?? null,
              structuredError.message,
              truncatedStack ?? null,
              attempt,
              maxAttempts
            ]
          );
        });
      } catch (recordError) {
        const recordMessage = recordError instanceof Error ? recordError.message : String(recordError);
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            event: "failure.record_error",
            tenantId,
            correlationId,
            queueName: job.queueName,
            jobId: job.id?.toString(),
            errorMessage: recordMessage
          })
        );
      }

      await withTenantClient(tenantId, async (client) => {
        await client.query(
          `
            UPDATE docs
            SET
              status = 'failed',
              ingestion_status = 'failed',
              ingestion_status_updated_at = now(),
              error_message = LEFT($3, 500),
              updated_at = now()
            WHERE tenant_id = $1
              AND id = $2
          `,
          [tenantId, docId, error instanceof Error ? error.message : "Ingestion failed"]
        );
      });

      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify(
          toStructuredLogEvent(baseLogContext, "job.error", {
            startedAt: startedAtIso,
            elapsedMs: Date.now() - startedAt,
            attempt,
            maxAttempts,
            errorClass,
            errorCode: structuredError.code ?? classifiedError.code,
            errorMessage: structuredError.message,
            errorStack: truncatedStack
          })
        )
      );

      if (errorClass === ErrorClass.PERMANENT) {
        throw new UnrecoverableError(structuredError.message);
      }

      throw error;
    }
  },
  {
    connection: redisConnection
  }
);

const mailNotificationsWorker = new Worker<MailNotificationJob>(
  mailNotificationsQueueName,
  async (job) => {
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    const provider = job.data.provider ?? "gmail";
    const stage = job.data.stage ?? "mail_notification";
    const safeCorrelationId =
      typeof job.data.correlationId === "string" && job.data.correlationId.length > 0
        ? (job.data.correlationId as CorrelationId)
        : undefined;
    const safeTenantId =
      typeof job.data.tenantId === "string" && job.data.tenantId.length > 0 ? job.data.tenantId : undefined;
    const safeReceiptId =
      typeof job.data.receiptId === "string" && job.data.receiptId.length > 0 ? job.data.receiptId : undefined;

    const baseLogContext = toStructuredLogContext({
      tenantId:
        typeof job.data.tenantId === "string" && job.data.tenantId.length > 0
          ? job.data.tenantId
          : undefined,
      mailboxId:
        typeof job.data.mailboxId === "string" && job.data.mailboxId.length > 0
          ? job.data.mailboxId
          : undefined,
      provider,
      stage,
      queueName: job.queueName,
      jobId: job.id?.toString(),
      correlationId: safeCorrelationId,
      messageId:
        typeof job.data.messageId === "string" && job.data.messageId.length > 0
          ? job.data.messageId
          : undefined,
      gmailHistoryId:
        typeof job.data.gmailHistoryId === "string" && job.data.gmailHistoryId.length > 0
          ? job.data.gmailHistoryId
          : undefined
    });
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? DEFAULT_JOB_ATTEMPTS;

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        toStructuredLogEvent(baseLogContext, "job.start", {
          startedAt: startedAtIso,
          attempt,
          maxAttempts
        })
      )
    );

    try {
      const tenantId = assertRequiredString(job.data.tenantId, "tenantId");
      const correlationId = assertRequiredString(job.data.correlationId, "correlationId");
      const messageId = assertRequiredString(job.data.messageId, "messageId");
      const receiptId = assertRequiredString(job.data.receiptId, "receiptId");

      const transitionResult = await withTenantClient(tenantId, async (client) => {
        const receiptResult = await client.query(
          `
            SELECT
              id::text AS id,
              processing_status,
              processed_at::text AS processed_at
            FROM mail_notification_receipts
            WHERE tenant_id = $1
              AND id = $2
            FOR UPDATE
          `,
          [tenantId, receiptId]
        );
        const receipt = receiptResult.rows[0] as MailNotificationReceiptRow | undefined;

        if (!receipt) {
          throw new Error(`mail_notification_receipt missing for id=${receiptId}`);
        }

        const status = receipt.processing_status;
        const isTerminalStatus =
          status === "done" || status === "failed_permanent" || status === "ignored";

        if (isTerminalStatus || receipt.processed_at) {
          if (receipt.processed_at && status !== "done") {
            await client.query(
              `
                UPDATE mail_notification_receipts
                SET
                  processing_status = 'done'
                WHERE tenant_id = $1
                  AND id = $2
              `,
              [tenantId, receiptId]
            );
          }

          return {
            mode: "ignored",
            reason: receipt.processed_at ? "already_processed" : `status_${status}`
          } as const;
        }

        await client.query(
          `
            UPDATE mail_notification_receipts
            SET
              processing_status = 'processing',
              processing_started_at = now(),
              processing_attempts = processing_attempts + 1,
              last_error = NULL,
              last_error_class = NULL,
              last_error_at = NULL
            WHERE tenant_id = $1
              AND id = $2
          `,
          [tenantId, receiptId]
        );

        // No provider side-effects in this step; downstream behavior remains deterministic/no-op.
        void correlationId;
        void messageId;

        await client.query(
          `
            UPDATE mail_notification_receipts
            SET
              processing_status = 'done',
              processed_at = now(),
              last_error = NULL,
              last_error_class = NULL,
              last_error_at = NULL
            WHERE tenant_id = $1
              AND id = $2
          `,
          [tenantId, receiptId]
        );

        return {
          mode: "done"
        } as const;
      });

      if (transitionResult.mode === "ignored") {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            event: "job.ignored",
            reason: transitionResult.reason,
            tenantId,
            queueName: job.queueName,
            stage,
            jobId: job.id?.toString(),
            receiptId,
            correlationId,
            attempt,
            maxAttempts
          })
        );
      }

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          toStructuredLogEvent(baseLogContext, "job.done", {
            startedAt: startedAtIso,
            elapsedMs: Date.now() - startedAt,
            attempt,
            maxAttempts
          })
        )
      );
    } catch (error) {
      const classifiedError = classifyError(error);
      const errorClass =
        classifiedError.class === ErrorClass.TRANSIENT ? ErrorClass.TRANSIENT : ErrorClass.PERMANENT;
      const structuredError = toLogError(error);
      const truncatedStack = truncateText(toSafeStack(structuredError.stack), 4000);
      const finalStatus = errorClass === ErrorClass.TRANSIENT ? "failed_transient" : "failed_permanent";
      const finalErrorClass = errorClass === ErrorClass.TRANSIENT ? "transient" : "permanent";

      if (safeTenantId && safeReceiptId) {
        try {
          await withTenantClient(safeTenantId, async (client) => {
            await client.query(
              `
                UPDATE mail_notification_receipts
                SET
                  processing_status = $3,
                  last_error_class = $4,
                  last_error = LEFT($5, 1000),
                  last_error_at = now()
                WHERE tenant_id = $1
                  AND id = $2
              `,
              [safeTenantId, safeReceiptId, finalStatus, finalErrorClass, structuredError.message]
            );
          });
        } catch {
          // ignore best-effort persistence failure
        }
      }

      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ...toStructuredLogContext(baseLogContext),
          event: "job.error",
          startedAt: startedAtIso,
          elapsedMs: Date.now() - startedAt,
          attempt,
          maxAttempts,
          errorClass,
          errorCode: structuredError.code ?? classifiedError.code,
          errorMessage: structuredError.message,
          errorStack: truncatedStack,
          receiptId: safeReceiptId
        })
      );

      if (errorClass === ErrorClass.PERMANENT) {
        throw new UnrecoverableError(structuredError.message);
      }

      throw error;
    }
  },
  {
    connection: redisConnection
  }
);

const mailboxSyncWorker = new Worker<MailboxSyncJob>(
  mailboxSyncQueueName,
  async (job) => {
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();

    const safeTenantId =
      typeof job.data.tenantId === "string" && job.data.tenantId.length > 0 ? job.data.tenantId : undefined;
    const safeMailboxId =
      typeof job.data.mailboxId === "string" && job.data.mailboxId.length > 0 ? job.data.mailboxId : undefined;
    const provider = job.data.provider ?? "gmail";
    let mailboxRunId: string | null = null;
    let mailboxRunCorrelationId = resolveMailboxRunCorrelationId(undefined);
    let mailboxRunFromHistoryId = "0";
    let mailboxRunToHistoryId = "0";

    const baseLogContext = toStructuredLogContext({
      tenantId: safeTenantId,
      mailboxId: safeMailboxId,
      provider,
      stage: "mailbox_sync",
      queueName: job.queueName,
      jobId: job.id?.toString()
    });
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? DEFAULT_JOB_ATTEMPTS;

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        toStructuredLogEvent(baseLogContext, "job.start", {
          startedAt: startedAtIso,
          attempt,
          maxAttempts
        })
      )
    );

    try {
      const tenantId = assertRequiredString(job.data.tenantId, "tenantId");
      const mailboxId = assertRequiredString(job.data.mailboxId, "mailboxId");

      const runInit = await withTenantClient(tenantId, async (client) => {
        const stateResult = await client.query(
          `
            SELECT
              last_history_id::text AS last_history_id,
              pending_max_history_id::text AS pending_max_history_id,
              last_correlation_id::text AS last_correlation_id
            FROM mailbox_sync_state
            WHERE tenant_id = $1
              AND mailbox_id = $2
              AND provider = $3
            FOR UPDATE
          `,
          [tenantId, mailboxId, provider]
        );
        const state = stateResult.rows[0] as MailboxSyncStateSnapshotRow | undefined;
        if (!state) {
          throw new Error("mailbox_sync_state missing for mailbox/provider");
        }

        const correlationId = resolveMailboxRunCorrelationId(state.last_correlation_id);
        const fromHistoryId = String(state.last_history_id ?? "0");
        const toHistoryId = String(state.pending_max_history_id ?? fromHistoryId);

        const insertResult = await client.query(
          `
            INSERT INTO mailbox_sync_runs (
              tenant_id,
              mailbox_id,
              provider,
              correlation_id,
              from_history_id,
              to_history_id,
              fetched_count,
              status,
              started_at,
              created_at
            )
            VALUES ($1, $2, $3, $4::uuid, $5, $6, 0, 'done', now(), now())
            RETURNING id::text AS id
          `,
          [tenantId, mailboxId, provider, correlationId, fromHistoryId, toHistoryId]
        );

        return {
          runId: String(insertResult.rows[0]?.id ?? ""),
          correlationId,
          fromHistoryId,
          toHistoryId
        };
      });

      mailboxRunId = runInit.runId;
      mailboxRunCorrelationId = runInit.correlationId;
      mailboxRunFromHistoryId = runInit.fromHistoryId;
      mailboxRunToHistoryId = runInit.toHistoryId;

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "mailbox.sync.run.start",
          correlationId: mailboxRunCorrelationId,
          tenantId,
          mailboxId,
          provider,
          runId: mailboxRunId,
          fromHistoryId: mailboxRunFromHistoryId,
          toHistoryId: mailboxRunToHistoryId,
          jobId: job.id?.toString() ?? null,
          attempt,
          maxAttempts
        })
      );

      const maxDrainPasses = 5;
      let drainPasses = 0;
      let result:
        | {
            mode: "ignored";
            reason: "no_pending";
            lastHistoryId: string;
            pendingMaxHistoryId: string;
          }
        | {
            mode: "done";
            lastHistoryId: string;
            pendingMaxHistoryId: string;
          } = {
        mode: "ignored",
        reason: "no_pending",
        lastHistoryId: "0",
        pendingMaxHistoryId: "0"
      };

      while (drainPasses < maxDrainPasses) {
        const passResult = await withTenantClient(tenantId, async (client) => {
          const existsResult = await client.query(
            `
              SELECT 1
              FROM mailbox_sync_state
              WHERE tenant_id = $1
                AND mailbox_id = $2
                AND provider = $3
              FOR UPDATE
            `,
            [tenantId, mailboxId, provider]
          );
          if (existsResult.rowCount === 0) {
            throw new Error("mailbox_sync_state missing for mailbox/provider");
          }

          await client.query(
            `
              UPDATE mailbox_sync_state
              SET
                pending_max_history_id = GREATEST(pending_max_history_id, last_history_id),
                updated_at = now()
              WHERE tenant_id = $1
                AND mailbox_id = $2
                AND provider = $3
            `,
            [tenantId, mailboxId, provider]
          );

          const advancedResult = await client.query(
            `
              UPDATE mailbox_sync_state
              SET
                last_history_id = pending_max_history_id,
                last_processed_at = now(),
                enqueued_at = NULL,
                enqueued_job_id = NULL,
                last_error = NULL,
                updated_at = now()
              WHERE tenant_id = $1
                AND mailbox_id = $2
                AND provider = $3
                AND pending_max_history_id > last_history_id
              RETURNING
                last_history_id::text AS last_history_id,
                pending_max_history_id::text AS pending_max_history_id
            `,
            [tenantId, mailboxId, provider]
          );
          const advancedRow = advancedResult.rows[0] as
            | { last_history_id?: string; pending_max_history_id?: string }
            | undefined;
          if (advancedRow) {
            return {
              mode: "advanced",
              lastHistoryId: String(advancedRow.last_history_id ?? "0"),
              pendingMaxHistoryId: String(advancedRow.pending_max_history_id ?? "0")
            } as const;
          }

          const idleResult = await client.query(
            `
              UPDATE mailbox_sync_state
              SET
                enqueued_at = NULL,
                enqueued_job_id = NULL,
                updated_at = now()
              WHERE tenant_id = $1
                AND mailbox_id = $2
                AND provider = $3
              RETURNING
                last_history_id::text AS last_history_id,
                pending_max_history_id::text AS pending_max_history_id
            `,
            [tenantId, mailboxId, provider]
          );
          const idleRow = idleResult.rows[0] as
            | { last_history_id?: string; pending_max_history_id?: string }
            | undefined;

          return {
            mode: "idle",
            lastHistoryId: String(idleRow?.last_history_id ?? "0"),
            pendingMaxHistoryId: String(idleRow?.pending_max_history_id ?? "0")
          } as const;
        });

        drainPasses += 1;

        if (passResult.mode === "idle") {
          if (drainPasses === 1) {
            result = {
              mode: "ignored",
              reason: "no_pending",
              lastHistoryId: passResult.lastHistoryId,
              pendingMaxHistoryId: passResult.pendingMaxHistoryId
            };
          }
          break;
        }

        result = {
          mode: "done",
          lastHistoryId: passResult.lastHistoryId,
          pendingMaxHistoryId: passResult.pendingMaxHistoryId
        };
      }

      mailboxRunToHistoryId = result.lastHistoryId;
      const historyFetchBoundary = await fetchMailboxHistoryBoundaryStub({
        tenantId,
        mailboxId,
        provider,
        correlationId: mailboxRunCorrelationId,
        fromHistoryId: mailboxRunFromHistoryId,
        toHistoryId: mailboxRunToHistoryId
      });

      if (mailboxRunId) {
        await withTenantClient(tenantId, async (client) => {
          await client.query(
            `
              UPDATE mailbox_sync_runs
              SET
                from_history_id = $3,
                to_history_id = $4,
                fetched_count = $5,
                status = 'done',
                last_error_class = NULL,
                last_error = NULL,
                finished_at = now()
              WHERE id = $1::uuid
                AND tenant_id = $2::uuid
            `,
            [mailboxRunId, tenantId, mailboxRunFromHistoryId, mailboxRunToHistoryId, historyFetchBoundary.fetchedCount]
          );
        });
      }

      if (result.mode === "ignored") {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            event: "job.ignored",
            reason: result.reason,
            tenantId,
            mailboxId,
            queueName: job.queueName,
            jobId: job.id?.toString(),
            stage: "mailbox_sync",
            attempt,
            maxAttempts
          })
        );
      }

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "mailbox.sync.run.done",
          correlationId: mailboxRunCorrelationId,
          tenantId,
          mailboxId,
          provider,
          runId: mailboxRunId,
          fromHistoryId: mailboxRunFromHistoryId,
          toHistoryId: mailboxRunToHistoryId,
          fetchedCount: historyFetchBoundary.fetchedCount,
          elapsedMs: Date.now() - startedAt,
          jobId: job.id?.toString() ?? null,
          attempt,
          maxAttempts
        })
      );

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          ...toStructuredLogContext(baseLogContext),
          event: "job.done",
          startedAt: startedAtIso,
          elapsedMs: Date.now() - startedAt,
          attempt,
          maxAttempts,
          lastHistoryId: result.lastHistoryId,
          pendingMaxHistoryId: result.pendingMaxHistoryId,
          drainPasses
        })
      );
    } catch (error) {
      const classifiedError = classifyError(error);
      const errorClass =
        classifiedError.class === ErrorClass.TRANSIENT ? ErrorClass.TRANSIENT : ErrorClass.PERMANENT;
      const structuredError = toLogError(error);
      const truncatedStack = truncateText(toSafeStack(structuredError.stack), 4000);

      if (safeTenantId && safeMailboxId) {
        try {
          await withTenantClient(safeTenantId, async (client) => {
            await client.query(
              `
                UPDATE mailbox_sync_state
                SET
                  last_error = LEFT($4, 500),
                  updated_at = now()
                WHERE tenant_id = $1
                  AND mailbox_id = $2
                  AND provider = $3
              `,
              [safeTenantId, safeMailboxId, provider, structuredError.message]
            );
          });
        } catch {
          // ignore best-effort persistence failure
        }
      }

      if (mailboxRunId && safeTenantId && safeMailboxId) {
        try {
          const failedStatus =
            errorClass === ErrorClass.TRANSIENT ? "failed_transient" : "failed_permanent";
          const failedErrorClass =
            errorClass === ErrorClass.TRANSIENT ? "transient" : "permanent";
          await withTenantClient(safeTenantId, async (client) => {
            await client.query(
              `
                UPDATE mailbox_sync_runs
                SET
                  status = $3,
                  last_error_class = $4,
                  last_error = LEFT($5, 1000),
                  finished_at = now()
                WHERE id = $1::uuid
                  AND tenant_id = $2::uuid
              `,
              [mailboxRunId, safeTenantId, failedStatus, failedErrorClass, structuredError.message]
            );
          });
        } catch {
          // ignore best-effort persistence failure
        }
      }

      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          event: "mailbox.sync.run.error",
          correlationId: mailboxRunCorrelationId,
          tenantId: safeTenantId ?? null,
          mailboxId: safeMailboxId ?? null,
          provider,
          runId: mailboxRunId,
          fromHistoryId: mailboxRunFromHistoryId,
          toHistoryId: mailboxRunToHistoryId,
          errorClass,
          errorMessage: structuredError.message,
          jobId: job.id?.toString() ?? null,
          attempt,
          maxAttempts
        })
      );

      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify(
          toStructuredLogEvent(baseLogContext, "job.error", {
            startedAt: startedAtIso,
            elapsedMs: Date.now() - startedAt,
            attempt,
            maxAttempts,
            errorClass,
            errorCode: structuredError.code ?? classifiedError.code,
            errorMessage: structuredError.message,
            errorStack: truncatedStack
          })
        )
      );

      if (errorClass === ErrorClass.PERMANENT) {
        throw new UnrecoverableError(structuredError.message);
      }

      throw error;
    }
  },
  {
    connection: redisConnection
  }
);

let readyLogPrinted = false;
const emitWorkerReady = () => {
  if (readyLogPrinted) {
    return;
  }
  readyLogPrinted = true;
  // eslint-disable-next-line no-console
  console.log(`worker ready (${workerName}) at ${new Date().toISOString()}`);
};

ingestionWorker.on("ready", emitWorkerReady);
mailNotificationsWorker.on("ready", emitWorkerReady);
mailboxSyncWorker.on("ready", emitWorkerReady);
