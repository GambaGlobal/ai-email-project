import type { FastifyPluginAsync } from "fastify";
import { queryOne, withTenantClient } from "../lib/db.js";
import { resolveTenantId } from "../lib/tenant.js";

type ConnectionStatus = "connected" | "disconnected" | "reconnect_required";

const gmailConnectionRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { tenant_id?: string } }>(
    "/v1/mail/gmail/connection",
    async (request, reply) => {
      const tenantId = resolveTenantId(request);
      if (!tenantId) {
        return reply.code(400).send({ error: "Missing or invalid tenant context" });
      }

      try {
        const row = await withTenantClient(tenantId, async (client) => {
          return queryOne(
            client,
            `
              SELECT
                status,
                last_verified_at,
                updated_at
              FROM mail_provider_connections
              WHERE tenant_id = $1
                AND provider = 'gmail'
              LIMIT 1
            `,
            [tenantId]
          );
        });

        const normalizedStatus = normalizeStatus(
          typeof row?.status === "string" ? row.status : null
        );

        return reply.send({
          status: normalizedStatus,
          last_verified_at:
            row?.last_verified_at instanceof Date
              ? row.last_verified_at.toISOString()
              : typeof row?.last_verified_at === "string"
                ? row.last_verified_at
                : null,
          updated_at:
            row?.updated_at instanceof Date
              ? row.updated_at.toISOString()
              : typeof row?.updated_at === "string"
                ? row.updated_at
                : new Date().toISOString()
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
