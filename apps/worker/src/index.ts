import { randomUUID } from "node:crypto";
import { createDecipheriv } from "node:crypto";
import { UnrecoverableError, Worker } from "bullmq";
import IORedis from "ioredis";
import { Pool, type PoolClient } from "pg";
import { GmailProvider } from "../../../packages/mail-gmail/src/gmail-provider.js";
import {
  type GetThreadRequest,
  type Cursor,
  DEFAULT_JOB_ATTEMPTS,
  ErrorClass,
  type LabelId,
  type LabelKey,
  type MailboxId,
  type MailChange,
  type ThreadId,
  type NormalizedThread,
  type UpsertThreadDraftResponse,
  KILL_SWITCH_DOCS_INGESTION,
  KILL_SWITCH_MAILBOX_SYNC,
  KILL_SWITCH_MAIL_NOTIFICATIONS,
  classifyError,
  isGlobalDocsIngestionDisabled,
  isGlobalMailboxSyncDisabled,
  isGlobalMailNotificationsDisabled,
  type CorrelationId
} from "@ai-email/shared";
import { toLogError, toStructuredLogContext, toStructuredLogEvent } from "./logging.js";
import {
  applyThreadStateLabelsForThreads,
  collectThreadContextsForChanges,
  decideThreadStateFromOutcome,
  syncMailbox,
  type MailboxCursorStore,
  type MailboxSyncProvider
} from "./mailbox-sync.js";

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

type MailProviderConnectionRow = {
  access_token_ciphertext: string | null;
  access_token_iv: string | null;
  access_token_tag: string | null;
  refresh_token_ciphertext: string | null;
  refresh_token_iv: string | null;
  refresh_token_tag: string | null;
  status: string;
};

type MailboxAddressRow = {
  email_address: string;
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

function readTokenEncryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required to decrypt Gmail access tokens");
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const base64 = Buffer.from(raw, "base64");
  if (base64.length === 32) {
    return base64;
  }

  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) {
    return utf8;
  }

  throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes (hex/base64/plain-text)");
}

function decryptToken(input: { ciphertext: string; iv: string; tag: string }): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    readTokenEncryptionKey(),
    Buffer.from(input.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(input.tag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

async function loadMailboxAddress(tenantId: string, mailboxId: string): Promise<string> {
  return withTenantClient(tenantId, async (client) => {
    const result = await client.query(
      `
        SELECT email_address
        FROM mailboxes
        WHERE tenant_id = $1
          AND id = $2
          AND provider = 'gmail'
        LIMIT 1
      `,
      [tenantId, mailboxId]
    );
    const row = result.rows[0] as MailboxAddressRow | undefined;
    if (!row?.email_address) {
      throw new Error(`mailbox missing or not gmail tenantId=${tenantId} mailboxId=${mailboxId}`);
    }
    return row.email_address;
  });
}

async function loadGmailAccessToken(tenantId: string): Promise<string> {
  return withTenantClient(tenantId, async (client) => {
    const result = await client.query(
      `
        SELECT
          access_token_ciphertext,
          access_token_iv,
          access_token_tag,
          refresh_token_ciphertext,
          refresh_token_iv,
          refresh_token_tag,
          status
        FROM mail_provider_connections
        WHERE tenant_id = $1
          AND provider = 'gmail'
        LIMIT 1
      `,
      [tenantId]
    );
    const row = result.rows[0] as MailProviderConnectionRow | undefined;
    if (!row) {
      throw new Error(`gmail connection missing for tenantId=${tenantId}`);
    }
    if (row.status !== "connected") {
      throw new Error(`gmail connection not connected for tenantId=${tenantId}`);
    }
    if (row.access_token_ciphertext && row.access_token_iv && row.access_token_tag) {
      return decryptToken({
        ciphertext: row.access_token_ciphertext,
        iv: row.access_token_iv,
        tag: row.access_token_tag
      });
    }
    if (row.refresh_token_ciphertext && row.refresh_token_iv && row.refresh_token_tag) {
      return decryptToken({
        ciphertext: row.refresh_token_ciphertext,
        iv: row.refresh_token_iv,
        tag: row.refresh_token_tag
      });
    }
    throw new Error(`gmail token missing for tenantId=${tenantId}`);
  });
}

class PgMailboxCursorStore implements MailboxCursorStore {
  async get(tenantId: string, mailboxId: string): Promise<string | null> {
    return withTenantClient(tenantId, async (client) => {
      const result = await client.query(
        `
          SELECT last_history_id::text AS last_history_id
          FROM mailbox_sync_state
          WHERE tenant_id = $1
            AND mailbox_id = $2
            AND provider = 'gmail'
          LIMIT 1
        `,
        [tenantId, mailboxId]
      );
      const row = result.rows[0] as { last_history_id?: string } | undefined;
      return row?.last_history_id ? String(row.last_history_id) : null;
    });
  }

  async set(tenantId: string, mailboxId: string, historyId: string): Promise<void> {
    await withTenantClient(tenantId, async (client) => {
      await client.query(
        `
          UPDATE mailbox_sync_state
          SET
            last_history_id = $3,
            pending_max_history_id = GREATEST(pending_max_history_id, $3),
            last_processed_at = now(),
            updated_at = now()
          WHERE tenant_id = $1
            AND mailbox_id = $2
            AND provider = 'gmail'
        `,
        [tenantId, mailboxId, historyId]
      );
    });
  }
}

class GmailMailboxSyncProvider implements MailboxSyncProvider {
  private readonly provider = new GmailProvider();

  async listChanges(input: {
    tenantId: string;
    mailboxId: string;
    startHistoryId: string;
  }): Promise<{ changes: MailChange[]; nextHistoryId: string }> {
    const accessToken = await loadGmailAccessToken(input.tenantId);
    const userId = await loadMailboxAddress(input.tenantId, input.mailboxId);
    const response = await this.provider.listChanges(
      {
        mailboxId: input.mailboxId as MailboxId,
        provider: "gmail",
        auth: {
          accessToken,
          userId
        }
      },
      {
        cursor: input.startHistoryId as Cursor
      }
    );

    return {
      changes: response.changes,
      nextHistoryId: String(response.nextCursor)
    };
  }

  async getBaselineHistoryId(input: {
    tenantId: string;
    mailboxId: string;
  }): Promise<string> {
    const accessToken = await loadGmailAccessToken(input.tenantId);
    const userId = await loadMailboxAddress(input.tenantId, input.mailboxId);
    const response = await this.provider.listChanges(
      {
        mailboxId: input.mailboxId as MailboxId,
        provider: "gmail",
        auth: {
          accessToken,
          userId
        }
      },
      {}
    );
    return String(response.nextCursor);
  }

  async getThread(input: {
    tenantId: string;
    mailboxId: string;
    threadId: string;
  }): Promise<NormalizedThread> {
    const accessToken = await loadGmailAccessToken(input.tenantId);
    const userId = await loadMailboxAddress(input.tenantId, input.mailboxId);
    const response = await this.provider.getThread(
      {
        mailboxId: input.mailboxId as MailboxId,
        provider: "gmail",
        auth: {
          accessToken,
          userId
        }
      },
      {
        threadId: input.threadId as GetThreadRequest["threadId"],
        includeBody: true
      }
    );
    return response.thread;
  }

  async ensureLabelsForTenant(input: {
    tenantId: string;
    mailboxId: string;
    labels: { key: LabelKey; name: string }[];
  }): Promise<{ labelIdsByKey: Record<LabelKey, LabelId> }> {
    const accessToken = await loadGmailAccessToken(input.tenantId);
    const userId = await loadMailboxAddress(input.tenantId, input.mailboxId);
    return this.provider.ensureLabels(
      {
        mailboxId: input.mailboxId as MailboxId,
        provider: "gmail",
        auth: {
          accessToken,
          userId
        }
      },
      {
        labels: input.labels
      }
    );
  }

  async setThreadStateLabelsForTenant(input: {
    tenantId: string;
    mailboxId: string;
    threadId: ThreadId;
    state: "drafted" | "needs_review" | "blocked";
    labelIdsByKey: Record<LabelKey, LabelId>;
  }): Promise<void> {
    const accessToken = await loadGmailAccessToken(input.tenantId);
    const userId = await loadMailboxAddress(input.tenantId, input.mailboxId);
    await this.provider.setThreadStateLabels(
      {
        mailboxId: input.mailboxId as MailboxId,
        provider: "gmail",
        auth: {
          accessToken,
          userId
        }
      },
      {
        threadId: input.threadId,
        state: input.state,
        labelIdsByKey: input.labelIdsByKey
      }
    );
  }
}

const mailboxCursorStore = new PgMailboxCursorStore();
const gmailMailboxSyncProvider = new GmailMailboxSyncProvider();

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

      let mailNotificationsKillSwitch:
        | { disabled: false; scope: null; key: string; reason: null }
        | { disabled: true; scope: "global" | "tenant"; key: string; reason: string } = {
        disabled: false,
        scope: null,
        key: KILL_SWITCH_MAIL_NOTIFICATIONS,
        reason: null
      };
      if (isGlobalMailNotificationsDisabled(process.env)) {
        mailNotificationsKillSwitch = {
          disabled: true,
          scope: "global",
          key: KILL_SWITCH_MAIL_NOTIFICATIONS,
          reason: "mail_notifications disabled by global env"
        };
      } else {
        const tenantKillSwitch = await getTenantKillSwitchState(tenantId, KILL_SWITCH_MAIL_NOTIFICATIONS);
        if (tenantKillSwitch?.isEnabled) {
          mailNotificationsKillSwitch = {
            disabled: true,
            scope: "tenant",
            key: KILL_SWITCH_MAIL_NOTIFICATIONS,
            reason: tenantKillSwitch.reason ?? "mail_notifications disabled by tenant kill switch"
          };
        }
      }

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

        if (mailNotificationsKillSwitch.disabled) {
          await client.query(
            `
              UPDATE mail_notification_receipts
              SET
                processing_status = 'ignored',
                processed_at = COALESCE(processed_at, now()),
                last_error_class = 'permanent',
                last_error = LEFT($3, 1000),
                last_error_at = now()
              WHERE tenant_id = $1
                AND id = $2
            `,
            [tenantId, receiptId, mailNotificationsKillSwitch.reason]
          );

          return {
            mode: "ignored",
            reason: "kill_switch",
            killSwitchScope: mailNotificationsKillSwitch.scope,
            killSwitchKey: mailNotificationsKillSwitch.key,
            killSwitchReason: mailNotificationsKillSwitch.reason
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
            key: "killSwitchKey" in transitionResult ? transitionResult.killSwitchKey : null,
            scope: "killSwitchScope" in transitionResult ? transitionResult.killSwitchScope : null,
            killSwitchReason:
              "killSwitchReason" in transitionResult ? transitionResult.killSwitchReason : null,
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
      let mailboxSyncKillSwitch:
        | { disabled: false; scope: null; key: string; reason: null }
        | { disabled: true; scope: "global" | "tenant"; key: string; reason: string } = {
        disabled: false,
        scope: null,
        key: KILL_SWITCH_MAILBOX_SYNC,
        reason: null
      };
      if (isGlobalMailboxSyncDisabled(process.env)) {
        mailboxSyncKillSwitch = {
          disabled: true,
          scope: "global",
          key: KILL_SWITCH_MAILBOX_SYNC,
          reason: "mailbox_sync disabled by global env"
        };
      } else {
        const tenantKillSwitch = await getTenantKillSwitchState(tenantId, KILL_SWITCH_MAILBOX_SYNC);
        if (tenantKillSwitch?.isEnabled) {
          mailboxSyncKillSwitch = {
            disabled: true,
            scope: "tenant",
            key: KILL_SWITCH_MAILBOX_SYNC,
            reason: tenantKillSwitch.reason ?? "mailbox_sync disabled by tenant kill switch"
          };
        }
      }
      if (mailboxSyncKillSwitch.disabled) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            event: "job.ignored",
            reason: "kill_switch",
            key: mailboxSyncKillSwitch.key,
            scope: mailboxSyncKillSwitch.scope,
            killSwitchReason: mailboxSyncKillSwitch.reason,
            tenantId,
            mailboxId,
            queueName: job.queueName,
            jobId: job.id?.toString(),
            stage: "mailbox_sync",
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
            lastHistoryId: "0",
            pendingMaxHistoryId: "0",
            drainPasses: 0
          })
        );
        return;
      }

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

      const stateBeforeSync = await withTenantClient(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              last_history_id::text AS last_history_id,
              pending_max_history_id::text AS pending_max_history_id
            FROM mailbox_sync_state
            WHERE tenant_id = $1
              AND mailbox_id = $2
              AND provider = $3
            FOR UPDATE
          `,
          [tenantId, mailboxId, provider]
        );
        const row = result.rows[0] as
          | { last_history_id?: string; pending_max_history_id?: string }
          | undefined;
        if (!row) {
          throw new Error("mailbox_sync_state missing for mailbox/provider");
        }

        await client.query(
          `
            UPDATE mailbox_sync_state
            SET
              enqueued_at = NULL,
              enqueued_job_id = NULL,
              updated_at = now()
            WHERE tenant_id = $1
              AND mailbox_id = $2
              AND provider = $3
          `,
          [tenantId, mailboxId, provider]
        );

        return {
          lastHistoryId: String(row.last_history_id ?? "0"),
          pendingMaxHistoryId: String(row.pending_max_history_id ?? "0")
        };
      });

      let result:
        | {
            mode: "ignored";
            reason: "no_pending";
            lastHistoryId: string;
            pendingMaxHistoryId: string;
            changes: MailChange[];
          }
        | {
            mode: "done";
            lastHistoryId: string;
            pendingMaxHistoryId: string;
            changes: MailChange[];
          };

      if (BigInt(stateBeforeSync.pendingMaxHistoryId) <= BigInt(stateBeforeSync.lastHistoryId)) {
        result = {
          mode: "ignored",
          reason: "no_pending",
          lastHistoryId: stateBeforeSync.lastHistoryId,
          pendingMaxHistoryId: stateBeforeSync.pendingMaxHistoryId,
          changes: []
        };
      } else {
        const syncResult = await syncMailbox({
          cursorStore: mailboxCursorStore,
          provider: gmailMailboxSyncProvider,
          request: {
            tenantId,
            mailboxId,
            commitCursor: true
          }
        });

        if (process.env.MAILBOX_SYNC_FETCH_THREADS === "1") {
          const threadContexts = await collectThreadContextsForChanges({
            tenantId,
            mailboxId,
            changes: syncResult.changes,
            fetchThread: async ({ tenantId: threadTenantId, mailboxId: threadMailboxId, threadId }) =>
              gmailMailboxSyncProvider.getThread({
                tenantId: threadTenantId,
                mailboxId: threadMailboxId,
                threadId
              })
          });
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify({
              event: "mailbox.sync.thread_context.ready",
              tenantId,
              mailboxId,
              correlationId: mailboxRunCorrelationId,
              threadCount: threadContexts.length
            })
          );
        }

        if (process.env.MAILBOX_SYNC_APPLY_LABELS === "1") {
          const threadIds = Array.from(
            new Set(syncResult.changes.map((change) => String(change.threadId)))
          ).map((threadId) => threadId as ThreadId);

          if (threadIds.length > 0) {
            const decision = decideThreadStateFromOutcome({
              upsertResult: { action: "created" } as UpsertThreadDraftResponse
            });
            const labelApplyResult = await applyThreadStateLabelsForThreads({
              provider: {
                ensureLabels: ({ labels }) =>
                  gmailMailboxSyncProvider.ensureLabelsForTenant({
                    tenantId,
                    mailboxId,
                    labels
                  }),
                setThreadStateLabels: ({ threadId, state, labelIdsByKey }) =>
                  gmailMailboxSyncProvider.setThreadStateLabelsForTenant({
                    tenantId,
                    mailboxId,
                    threadId,
                    state,
                    labelIdsByKey
                  })
              },
              threadIds,
              state: decision.state
            });

            // eslint-disable-next-line no-console
            console.log(
              JSON.stringify({
                event: "mailbox.sync.state_labels.applied",
                tenantId,
                mailboxId,
                correlationId: mailboxRunCorrelationId,
                state: decision.state,
                reasonCode: decision.reasonCode,
                threadCount: labelApplyResult.appliedThreadIds.length
              })
            );
          }
        }

        const stateAfterSync = await withTenantClient(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                last_history_id::text AS last_history_id,
                pending_max_history_id::text AS pending_max_history_id
              FROM mailbox_sync_state
              WHERE tenant_id = $1
                AND mailbox_id = $2
                AND provider = $3
              LIMIT 1
            `,
            [tenantId, mailboxId, provider]
          );
          const row = result.rows[0] as
            | { last_history_id?: string; pending_max_history_id?: string }
            | undefined;
          if (!row) {
            throw new Error("mailbox_sync_state missing after sync");
          }
          return {
            lastHistoryId: String(row.last_history_id ?? syncResult.nextHistoryId),
            pendingMaxHistoryId: String(row.pending_max_history_id ?? syncResult.nextHistoryId)
          };
        });

        result = {
          mode: "done",
          lastHistoryId: stateAfterSync.lastHistoryId,
          pendingMaxHistoryId: stateAfterSync.pendingMaxHistoryId,
          changes: syncResult.changes
        };
      }

      mailboxRunToHistoryId = result.lastHistoryId;
      const fetchedCount = result.changes.length;

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
            [mailboxRunId, tenantId, mailboxRunFromHistoryId, mailboxRunToHistoryId, fetchedCount]
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
          fetchedCount,
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
          drainPasses: result.mode === "ignored" ? 0 : 1
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
