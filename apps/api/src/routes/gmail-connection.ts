import type { FastifyPluginAsync } from "fastify";
import { withTenantClient } from "../lib/db.js";
import { getGmailConnection } from "../lib/gmail-connection-store.js";
import { resolveTenantIdFromHeader, resolveTenantIdFromQuery } from "../lib/tenant.js";

type ConnectionStatus = "connected" | "disconnected" | "reconnect_required";

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
        const row = await withTenantClient(tenantId, async (client) => {
          return getGmailConnection(client, tenantId);
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
