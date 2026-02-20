import type { FastifyPluginAsync } from "fastify";
import { queryOne, withTenantClient } from "../lib/db.js";
import { getGmailConnection } from "../lib/gmail-connection-store.js";
import { resolveTenantIdFromHeader, resolveTenantIdFromQuery } from "../lib/tenant.js";

type ConnectionStatus = "connected" | "disconnected" | "reconnect_required";
type MailboxLookupRow = {
  mailbox_id?: string;
  email_address?: string;
  address?: string;
};

const gmailConnectionRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { tenant_id?: string } }>(
    "/v1/mail/gmail/connection",
    async (request, reply) => {
      let tenantId = resolveTenantIdFromHeader(request);

      if (!tenantId && process.env.ALLOW_TENANT_QUERY_FALLBACK === "true") {
        tenantId = resolveTenantIdFromQuery(request);
      }

      if (!tenantId) {
        return reply.code(400).send({
          error:
            "Missing tenant context. Send x-tenant-id header (or enable ALLOW_TENANT_QUERY_FALLBACK=true)."
        });
      }

      try {
        const connection = await withTenantClient(tenantId, async (client) => {
          const connectionRow = await getGmailConnection(client, tenantId);
          const mailboxRow = (await queryOne(
            client,
            `
              SELECT
                id::text AS mailbox_id,
                email_address,
                address
              FROM mailboxes
              WHERE tenant_id = $1
                AND provider = 'gmail'
              ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
              LIMIT 1
            `,
            [tenantId]
          )) as MailboxLookupRow | null;

          return {
            row: connectionRow,
            mailbox: mailboxRow
          };
        });

        const normalizedStatus = normalizeStatus(
          typeof connection.row?.status === "string" ? connection.row.status : null
        );
        const mailboxEmail =
          typeof connection.mailbox?.email_address === "string"
            ? connection.mailbox.email_address
            : typeof connection.mailbox?.address === "string"
              ? connection.mailbox.address
              : null;
        const mailboxAddress =
          typeof connection.mailbox?.address === "string"
            ? connection.mailbox.address
            : mailboxEmail;
        const connected = normalizedStatus === "connected";

        return reply.send({
          provider: "gmail",
          status: normalizedStatus,
          last_verified_at:
            connection.row?.last_verified_at instanceof Date
              ? connection.row.last_verified_at.toISOString()
              : typeof connection.row?.last_verified_at === "string"
                ? connection.row.last_verified_at
                : null,
          connected_at:
            connection.row?.connected_at instanceof Date
              ? connection.row.connected_at.toISOString()
              : typeof connection.row?.connected_at === "string"
                ? connection.row.connected_at
                : null,
          updated_at:
            connection.row?.updated_at instanceof Date
              ? connection.row.updated_at.toISOString()
              : typeof connection.row?.updated_at === "string"
                ? connection.row.updated_at
                : new Date().toISOString(),
          email: connected ? mailboxEmail : null,
          address: connected ? mailboxAddress : null,
          mailbox_id:
            connected && typeof connection.mailbox?.mailbox_id === "string"
              ? connection.mailbox.mailbox_id
              : null
        });
      } catch (error) {
        request.log.error({ error }, "Failed to load Gmail connection status");
        return reply.code(500).send({ error: "Unable to fetch Gmail connection status" });
      }
    }
  );
};

function normalizeStatus(status: string | null): ConnectionStatus {
  if (status === "connected") {
    return "connected";
  }

  if (status === "reconnect_required") {
    return "reconnect_required";
  }

  return "disconnected";
}

export default gmailConnectionRoutes;
