import type { FastifyPluginAsync } from "fastify";
import { asCorrelationId, newCorrelationId } from "@ai-email/shared";
import { queryOne, queryRowsGlobal, withTenantClient } from "../lib/db.js";
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
    const stage = "notification_ingestion";
    const queueName = "mail_notifications";

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
      const insertResult = await withTenantClient(tenantId, async (client) => {
        const row = await queryOne(
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
            RETURNING id::text AS id
          `,
          [tenantId, mailboxId, provider, messageId, parsed.gmailHistoryId, JSON.stringify(parsed.payload)]
        );

        return row;
      });

      if (!insertResult) {
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
            reason: "duplicate_receipt"
          })
        );

        return reply.code(204).send();
      }

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
          gmailHistoryId: parsed.gmailHistoryId
        })
      );

      // Queue enqueue happens after insert; dedupe must remain the boundary guard.
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
      return reply.code(204).send();
    }
  });
};

export default gmailNotificationRoutes;
