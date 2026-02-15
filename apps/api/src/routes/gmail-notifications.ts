import type { FastifyPluginAsync } from "fastify";
import { asCorrelationId, newCorrelationId } from "@ai-email/shared";
import { queryOne, queryRowsGlobal, withTenantClient } from "../lib/db.js";
import {
  enqueueMailNotification,
  mailNotificationJobId,
  MAIL_NOTIFICATIONS_QUEUE
} from "../lib/mail-notifications-queue.js";
import { toPubsubIdentifiers, toStructuredLogContext, toStructuredLogEvent } from "../logging.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const gmailHistoryId = asString(decodedPayload.historyId);
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
              payload
            )
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
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
                last_error = NULL
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
              SET last_error = LEFT($3, 500)
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

        return reply.code(204).send();
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
