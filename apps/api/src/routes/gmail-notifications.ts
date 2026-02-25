import type { FastifyPluginAsync } from "fastify";
import {
  KILL_SWITCH_MAIL_NOTIFICATIONS,
  KILL_SWITCH_MAILBOX_SYNC,
  asCorrelationId,
  isGlobalMailboxSyncDisabled,
  isGlobalMailNotificationsDisabled,
  newCorrelationId
} from "../lib/shared-runtime.js";
import { queryOne, queryRowsGlobal, withTenantClient } from "../lib/db.js";
import {
  enqueueMailNotification,
  mailNotificationJobId,
  MAIL_NOTIFICATIONS_QUEUE
} from "../lib/mail-notifications-queue.js";
import {
  enqueueMailboxSync,
  mailboxSyncJobId,
  MAILBOX_SYNC_QUEUE
} from "../lib/mailbox-sync-queue.js";
import { toPubsubIdentifiers, toStructuredLogContext, toStructuredLogEvent } from "../logging.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_PATTERN = /^[0-9]+$/;

type PubsubPushBody = {
  message?: {
    messageId?: string;
    data?: string;
    attributes?: Record<string, unknown>;
    publishTime?: string;
  };
  subscription?: string;
};

type DecodedNotificationPayload = {
  emailAddress?: string;
  historyId?: string;
};

type ReceiptRow = {
  id: string;
  enqueued_at: string | null;
  enqueued_job_id: string | null;
};

type MailboxSyncStateRow = {
  last_history_id: string;
  pending_max_history_id: string;
  enqueued_at: string | null;
  enqueued_job_id: string | null;
};

type TenantKillSwitchRow = {
  isEnabled: boolean;
  reason: string | null;
};

type KillSwitchDecision = {
  disabled: boolean;
  scope: "global" | "tenant" | null;
  key: string;
  reason: string | null;
};

function resolveCorrelationId(headers: Record<string, unknown>) {
  const raw = headers["x-correlation-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === "string" && value.trim().length > 0) {
    return asCorrelationId(value.trim());
  }
  return newCorrelationId();
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeHistoryId(value: string | null): string | null {
  if (!value || !NUMERIC_PATTERN.test(value)) {
    return null;
  }
  return value;
}

function parsePubsubBody(body: unknown): {
  messageId: string | null;
  gmailHistoryId: string | null;
  emailAddress: string | null;
  payload: Record<string, unknown>;
} {
  const typed = (typeof body === "object" && body !== null ? body : {}) as PubsubPushBody;
  const message = typed.message ?? {};

  const messageId = asString(message.messageId);
  const encodedData = asString(message.data);

  let decodedPayload: DecodedNotificationPayload = {};
  if (encodedData) {
    try {
      const json = Buffer.from(encodedData, "base64").toString("utf8");
      const parsed = JSON.parse(json);
      if (typeof parsed === "object" && parsed !== null) {
        decodedPayload = parsed as DecodedNotificationPayload;
      }
    } catch {
      decodedPayload = {};
    }
  }

  const gmailHistoryId = normalizeHistoryId(asString(decodedPayload.historyId));
  const emailAddress = asString(decodedPayload.emailAddress)?.toLowerCase() ?? null;

  const payload: Record<string, unknown> = {
    subscription: asString(typed.subscription),
    publishTime: asString(message.publishTime),
    attributes: typeof message.attributes === "object" && message.attributes !== null ? message.attributes : {},
    emailAddress,
    historyId: gmailHistoryId
  };

  return {
    messageId,
    gmailHistoryId,
    emailAddress,
    payload
  };
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function parseUuidHeader(headers: Record<string, unknown>, key: string): string | null {
  const value = asString(Array.isArray(headers[key]) ? headers[key][0] : headers[key]);
  if (!value || !UUID_PATTERN.test(value)) {
    return null;
  }
  return value;
}

function toUuidOrNull(value: string): string | null {
  return UUID_PATTERN.test(value) ? value : null;
}

async function resolveMailboxByEmail(emailAddress: string): Promise<{ tenantId: string; mailboxId: string } | null> {
  const rows = await queryRowsGlobal(
    `
      SELECT tenant_id::text AS tenant_id, id::text AS mailbox_id
      FROM mailboxes
      WHERE provider = 'gmail'
        AND lower(email_address) = lower($1)
      ORDER BY tenant_id ASC, id ASC
      LIMIT 2
    `,
    [emailAddress]
  );

  if (rows.length !== 1) {
    return null;
  }

  const row = rows[0] as { tenant_id: string; mailbox_id: string };
  return {
    tenantId: row.tenant_id,
    mailboxId: row.mailbox_id
  };
}

async function getTenantKillSwitchState(tenantId: string, key: string): Promise<TenantKillSwitchRow | null> {
  return withTenantClient(tenantId, async (client) => {
    const row = await queryOne(
      client,
      `
        SELECT is_enabled, reason
        FROM tenant_kill_switches
        WHERE tenant_id = $1
          AND key = $2
      `,
      [tenantId, key]
    );

    if (!row) {
      return null;
    }

    return {
      isEnabled: row.is_enabled === true,
      reason: typeof row.reason === "string" ? row.reason : null
    };
  });
}

function decideKillSwitch(input: {
  key: string;
  globalDisabled: boolean;
  tenantState: TenantKillSwitchRow | null;
}): KillSwitchDecision {
  if (input.globalDisabled) {
    return {
      disabled: true,
      scope: "global",
      key: input.key,
      reason: `${input.key} disabled by global env`
    };
  }

  if (input.tenantState?.isEnabled) {
    return {
      disabled: true,
      scope: "tenant",
      key: input.key,
      reason: input.tenantState.reason ?? `${input.key} disabled by tenant kill switch`
    };
  }

  return {
    disabled: false,
    scope: null,
    key: input.key,
    reason: null
  };
}

async function coalesceMailboxSync(input: {
  tenantId: string;
  mailboxId: string;
  provider: "gmail";
  historyId: string;
  correlationId: string;
  enqueueEnabled: boolean;
  killSwitchDecision: KillSwitchDecision | null;
}): Promise<
  | {
      kind: "enqueued";
      jobId: string;
      pendingMaxHistoryId: string;
      lastHistoryId: string;
    }
  | {
      kind: "deduped";
      reason: "already_enqueued";
      jobId: string;
      pendingMaxHistoryId: string;
      lastHistoryId: string;
    }
  | {
      kind: "ignored";
      reason: string;
      scope: "global" | "tenant";
      key: string;
      pendingMaxHistoryId: string;
      lastHistoryId: string;
    }
  | {
      kind: "failed";
      errorMessage: string;
    }
> {
  return withTenantClient(input.tenantId, async (client) => {
    const upserted = (await queryOne(
      client,
      `
        INSERT INTO mailbox_sync_state (
          tenant_id,
          mailbox_id,
          provider,
          last_history_id,
          pending_max_history_id,
          last_correlation_id,
          pending_updated_at,
          updated_at
        )
        VALUES ($1, $2, $3, 0, $4::numeric, $5::uuid, now(), now())
        ON CONFLICT (tenant_id, mailbox_id, provider)
        DO UPDATE
        SET
          pending_max_history_id = GREATEST(
            COALESCE(mailbox_sync_state.pending_max_history_id, COALESCE(mailbox_sync_state.last_history_id, 0)),
            EXCLUDED.pending_max_history_id
          ),
          last_correlation_id = EXCLUDED.last_correlation_id,
          pending_updated_at = now(),
          updated_at = now()
        RETURNING
          last_history_id::text,
          pending_max_history_id::text,
          enqueued_at::text,
          enqueued_job_id
      `,
      [input.tenantId, input.mailboxId, input.provider, input.historyId, toUuidOrNull(input.correlationId)]
    )) as MailboxSyncStateRow | null;

    if (!upserted) {
      return {
        kind: "failed",
        errorMessage: "mailbox-sync-state-upsert-failed"
      } as const;
    }

    const jobId = mailboxSyncJobId(input.provider, input.mailboxId);
    if (!input.enqueueEnabled) {
      const reason = input.killSwitchDecision?.reason ?? "mailbox_sync disabled by kill switch";
      await client.query(
        `
          UPDATE mailbox_sync_state
          SET
            enqueued_at = NULL,
            enqueued_job_id = NULL,
            last_error = LEFT($4, 500),
            updated_at = now()
          WHERE tenant_id = $1
            AND mailbox_id = $2
            AND provider = $3
        `,
        [input.tenantId, input.mailboxId, input.provider, reason]
      );

      return {
        kind: "ignored",
        reason,
        scope: input.killSwitchDecision?.scope ?? "tenant",
        key: input.killSwitchDecision?.key ?? KILL_SWITCH_MAILBOX_SYNC,
        pendingMaxHistoryId: upserted.pending_max_history_id,
        lastHistoryId: upserted.last_history_id
      } as const;
    }

    try {
      const enqueueResult = await enqueueMailboxSync(
        {
          tenantId: input.tenantId,
          mailboxId: input.mailboxId,
          provider: input.provider
        },
        jobId
      );

      await client.query(
        `
          UPDATE mailbox_sync_state
          SET
            enqueued_at = now(),
            enqueued_job_id = $4,
            last_error = NULL,
            updated_at = now()
          WHERE tenant_id = $1
            AND mailbox_id = $2
            AND provider = $3
        `,
        [input.tenantId, input.mailboxId, input.provider, enqueueResult.jobId ?? jobId]
      );

      if (enqueueResult.reused) {
        return {
          kind: "deduped",
          reason: "already_enqueued",
          jobId: enqueueResult.jobId ?? jobId,
          pendingMaxHistoryId: upserted.pending_max_history_id,
          lastHistoryId: upserted.last_history_id
        } as const;
      }

      return {
        kind: "enqueued",
        jobId: enqueueResult.jobId ?? jobId,
        pendingMaxHistoryId: upserted.pending_max_history_id,
        lastHistoryId: upserted.last_history_id
      } as const;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
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
        [input.tenantId, input.mailboxId, input.provider, errorMessage]
      );

      return {
        kind: "failed",
        errorMessage
      } as const;
    }
  });
}

const gmailNotificationRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/notifications/gmail", async (request, reply) => {
    const headers = request.headers as Record<string, unknown>;
    const correlationId = resolveCorrelationId(headers);
    const provider = "gmail";
    const stage = "mail_notification";
    const queueName = MAIL_NOTIFICATIONS_QUEUE;

    const parsed = parsePubsubBody(request.body);
    const messageId = parsed.messageId;

    if (!messageId) {
      const baseLogContext = toStructuredLogContext({
        provider,
        stage,
        queueName,
        correlationId,
        gmailHistoryId: parsed.gmailHistoryId ?? undefined
      });

      request.log.warn(
        toStructuredLogEvent(baseLogContext, "mail.notification.ignored", {
          ...toPubsubIdentifiers(headers)
        }),
        "Gmail notification ignored due to missing messageId"
      );

      console.log(
        JSON.stringify({
          event: "mail.notification.ignored",
          correlationId,
          provider,
          reason: "missing_message_id"
        })
      );
      return reply.code(204).send();
    }

    let tenantId: string | null = null;
    let mailboxId: string | null = null;

    const devTenantOverride = !isProduction() ? parseUuidHeader(headers, "x-tenant-id") : null;
    const devMailboxOverride = !isProduction() ? parseUuidHeader(headers, "x-mailbox-id") : null;

    if (devTenantOverride) {
      tenantId = devTenantOverride;
      mailboxId = devMailboxOverride;
    } else if (parsed.emailAddress) {
      const mailbox = await resolveMailboxByEmail(parsed.emailAddress);
      tenantId = mailbox?.tenantId ?? null;
      mailboxId = mailbox?.mailboxId ?? null;
    }

    const baseLogContext = toStructuredLogContext({
      tenantId: tenantId ?? undefined,
      mailboxId: mailboxId ?? undefined,
      provider,
      stage,
      queueName,
      correlationId,
      messageId,
      gmailHistoryId: parsed.gmailHistoryId ?? undefined
    });

    if (!tenantId) {
      request.log.info(
        toStructuredLogEvent(baseLogContext, "mail.notification.ignored", {
          ...toPubsubIdentifiers(headers)
        }),
        "Gmail notification ignored due to unresolved tenant"
      );

      console.log(
        JSON.stringify({
          event: "mail.notification.ignored",
          correlationId,
          provider,
          messageId,
          reason: "tenant_unresolved",
          gmailHistoryId: parsed.gmailHistoryId
        })
      );
      return reply.code(204).send();
    }

    let notificationsKillSwitchDecision: KillSwitchDecision;
    let mailboxSyncKillSwitchDecision: KillSwitchDecision;
    try {
      const [tenantMailNotificationsState, tenantMailboxSyncState] = await Promise.all([
        getTenantKillSwitchState(tenantId, KILL_SWITCH_MAIL_NOTIFICATIONS),
        getTenantKillSwitchState(tenantId, KILL_SWITCH_MAILBOX_SYNC)
      ]);
      notificationsKillSwitchDecision = decideKillSwitch({
        key: KILL_SWITCH_MAIL_NOTIFICATIONS,
        globalDisabled: isGlobalMailNotificationsDisabled(process.env),
        tenantState: tenantMailNotificationsState
      });
      mailboxSyncKillSwitchDecision = decideKillSwitch({
        key: KILL_SWITCH_MAILBOX_SYNC,
        globalDisabled: isGlobalMailboxSyncDisabled(process.env),
        tenantState: tenantMailboxSyncState
      });
    } catch (error) {
      request.log.error({ error, tenantId }, "Failed to evaluate mail kill switches");
      return reply.code(500).send({ error: "Unable to evaluate notification availability" });
    }

    try {
      const outcome = await withTenantClient(tenantId, async (client) => {
        const inserted = await queryOne(
          client,
          `
            INSERT INTO mail_notification_receipts (
              tenant_id,
              mailbox_id,
              provider,
              message_id,
              gmail_history_id,
              payload,
              processing_status
            )
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'received')
            ON CONFLICT (tenant_id, provider, message_id) DO NOTHING
            RETURNING id::text AS id, enqueued_at::text AS enqueued_at, enqueued_job_id
          `,
          [tenantId, mailboxId, provider, messageId, parsed.gmailHistoryId, JSON.stringify(parsed.payload)]
        );

        const receipt =
          (inserted as ReceiptRow | null) ??
          ((await queryOne(
            client,
            `
              SELECT id::text AS id, enqueued_at::text AS enqueued_at, enqueued_job_id
              FROM mail_notification_receipts
              WHERE tenant_id = $1
                AND provider = $2
                AND message_id = $3
              FOR UPDATE
            `,
            [tenantId, provider, messageId]
          )) as ReceiptRow | null);

        if (!receipt) {
          return {
            kind: "error",
            errorMessage: "receipt-not-found-after-insert"
          } as const;
        }

        const alreadyEnqueued = receipt.enqueued_at !== null;
        if (alreadyEnqueued) {
          return {
            kind: "already_enqueued",
            inserted: inserted !== null,
            receiptId: receipt.id,
            jobId: receipt.enqueued_job_id
          } as const;
        }

        const jobId = mailNotificationJobId(receipt.id);
        if (notificationsKillSwitchDecision.disabled) {
          await client.query(
            `
              UPDATE mail_notification_receipts
              SET
                processing_status = 'ignored',
                enqueued_at = NULL,
                enqueued_job_id = NULL,
                last_error = LEFT($3, 1000),
                last_error_at = now(),
                last_error_class = 'permanent'
              WHERE tenant_id = $1
                AND id = $2
            `,
            [tenantId, receipt.id, notificationsKillSwitchDecision.reason ?? "mail_notifications disabled"]
          );
          return {
            kind: "ignored",
            inserted: inserted !== null,
            receiptId: receipt.id,
            scope: notificationsKillSwitchDecision.scope ?? "tenant",
            key: notificationsKillSwitchDecision.key,
            reason: notificationsKillSwitchDecision.reason
          } as const;
        }

        try {
          const enqueueResult = await enqueueMailNotification(
            {
              tenantId,
              mailboxId,
              provider: "gmail",
              stage: "mail_notification",
              correlationId,
              messageId,
              receiptId: receipt.id,
              gmailHistoryId: parsed.gmailHistoryId,
              emailAddress: parsed.emailAddress
            },
            jobId
          );

          await client.query(
            `
              UPDATE mail_notification_receipts
              SET
                enqueued_at = now(),
                enqueued_job_id = $3,
                last_error = NULL,
                last_error_at = NULL,
                last_error_class = NULL,
                processing_status = 'enqueued'
              WHERE tenant_id = $1
                AND id = $2
            `,
            [tenantId, receipt.id, enqueueResult.jobId ?? jobId]
          );

          return {
            kind: "enqueued",
            inserted: inserted !== null,
            receiptId: receipt.id,
            jobId: enqueueResult.jobId ?? jobId
          } as const;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await client.query(
            `
              UPDATE mail_notification_receipts
              SET last_error = LEFT($3, 1000)
                ,last_error_at = now()
                ,last_error_class = 'transient'
                ,processing_status = 'failed_transient'
              WHERE tenant_id = $1
                AND id = $2
            `,
            [tenantId, receipt.id, errorMessage]
          );

          return {
            kind: "enqueue_failed",
            inserted: inserted !== null,
            receiptId: receipt.id,
            errorMessage
          } as const;
        }
      });

      if (outcome.kind === "error") {
        request.log.error(
          {
            correlationId,
            tenantId,
            provider,
            messageId,
            errorMessage: outcome.errorMessage
          },
          "Failed to resolve notification receipt"
        );
        return reply.code(500).send({ error: "Failed to process notification" });
      }

      if (outcome.inserted) {
        request.log.info(
          toStructuredLogEvent(baseLogContext, "mail.notification.received", {
            ...toPubsubIdentifiers(headers)
          }),
          "Gmail notification received"
        );

        console.log(
          JSON.stringify({
            event: "mail.notification.received",
            correlationId,
            tenantId,
            mailboxId,
            provider,
            messageId,
            gmailHistoryId: parsed.gmailHistoryId,
            receiptId: outcome.receiptId
          })
        );
      }

      if (outcome.kind === "already_enqueued") {
        request.log.info(
          toStructuredLogEvent(baseLogContext, "mail.notification.deduped", {
            ...toPubsubIdentifiers(headers)
          }),
          "Gmail notification deduped"
        );

        console.log(
          JSON.stringify({
            event: "mail.notification.deduped",
            correlationId,
            tenantId,
            provider,
            messageId,
            reason: "duplicate_receipt",
            receiptId: outcome.receiptId,
            jobId: outcome.jobId
          })
        );
      }

      if (outcome.kind === "ignored") {
        console.log(
          JSON.stringify({
            event: "mail.notification.ignored",
            correlationId,
            tenantId,
            mailboxId,
            provider,
            messageId,
            receiptId: outcome.receiptId,
            scope: outcome.scope,
            key: outcome.key,
            reason: outcome.reason ?? null
          })
        );
      }

      if (outcome.kind === "enqueue_failed") {
        request.log.error(
          {
            correlationId,
            tenantId,
            provider,
            messageId,
            receiptId: outcome.receiptId,
            errorMessage: outcome.errorMessage
          },
          "Failed to enqueue Gmail notification"
        );
        return reply.code(500).send({ error: "Failed to enqueue notification" });
      }

      if (outcome.kind === "enqueued") {
        request.log.info(
          toStructuredLogEvent(baseLogContext, "mail.notification.enqueued", {
            ...toPubsubIdentifiers(headers)
          }),
          "Gmail notification enqueued"
        );

        console.log(
          JSON.stringify({
            event: "mail.notification.enqueued",
            correlationId,
            tenantId,
            mailboxId,
            provider,
            messageId,
            gmailHistoryId: parsed.gmailHistoryId,
            receiptId: outcome.receiptId,
            jobId: outcome.jobId,
            queueName
          })
        );
      }

      if (!mailboxId || !parsed.gmailHistoryId) {
        console.log(
          JSON.stringify({
            event: "mailbox.sync.deduped",
            tenantId,
            mailboxId,
            provider,
            correlationId,
            reason: !mailboxId ? "mailbox_unresolved" : "history_id_missing"
          })
        );
        return reply.code(204).send();
      }

      const mailboxSyncOutcome = await coalesceMailboxSync({
        tenantId,
        mailboxId,
        provider: "gmail",
        historyId: parsed.gmailHistoryId,
        correlationId,
        enqueueEnabled: !mailboxSyncKillSwitchDecision.disabled,
        killSwitchDecision: mailboxSyncKillSwitchDecision
      });

      if (mailboxSyncOutcome.kind === "failed") {
        request.log.error(
          {
            correlationId,
            tenantId,
            mailboxId,
            provider,
            messageId,
            errorMessage: mailboxSyncOutcome.errorMessage
          },
          "Failed to coalesce mailbox sync state"
        );
        return reply.code(500).send({ error: "Failed to enqueue mailbox sync" });
      }

      console.log(
        JSON.stringify({
          event: "mailbox.sync.state_updated",
          tenantId,
          mailboxId,
          provider,
          correlationId,
          pendingMaxHistoryId: mailboxSyncOutcome.pendingMaxHistoryId,
          lastHistoryId: mailboxSyncOutcome.lastHistoryId
        })
      );

      if (mailboxSyncOutcome.kind === "deduped") {
        console.log(
          JSON.stringify({
            event: "mailbox.sync.deduped",
            tenantId,
            mailboxId,
            provider,
            correlationId,
            reason: mailboxSyncOutcome.reason,
            jobId: mailboxSyncOutcome.jobId
          })
        );
      } else if (mailboxSyncOutcome.kind === "ignored") {
        console.log(
          JSON.stringify({
            event: "mailbox.sync.ignored",
            tenantId,
            mailboxId,
            provider,
            correlationId,
            scope: mailboxSyncOutcome.scope,
            key: mailboxSyncOutcome.key,
            reason: mailboxSyncOutcome.reason
          })
        );
      } else {
        console.log(
          JSON.stringify({
            event: "mailbox.sync.enqueued",
            tenantId,
            mailboxId,
            provider,
            correlationId,
            jobId: mailboxSyncOutcome.jobId,
            queueName: MAILBOX_SYNC_QUEUE
          })
        );
      }

      return reply.code(204).send();
    } catch (error) {
      request.log.error(
        {
          correlationId,
          tenantId,
          provider,
          messageId,
          error
        },
        "Failed to persist Gmail notification receipt"
      );
      return reply.code(500).send({ error: "Failed to process notification" });
    }
  });
};

export default gmailNotificationRoutes;
