import type { FastifyPluginAsync } from "fastify";
import { retrieveSources, resolveTopK } from "../lib/retrieval.js";
import { resolveTenantIdFromHeader } from "../lib/tenant.js";

type RetrievalQueryBody = {
  query?: unknown;
  topK?: unknown;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalTopK(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return resolveTopK(parsed);
}

const retrievalRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: RetrievalQueryBody }>("/v1/retrieval/query", async (request, reply) => {
    const tenantId = resolveTenantIdFromHeader(request);
    if (!tenantId) {
      return reply.code(400).send({ error: "Missing tenant context. Send x-tenant-id header." });
    }

    const query = asNonEmptyString(request.body?.query);
    if (!query) {
      return reply.code(400).send({ error: "query is required" });
    }

    const topK = asOptionalTopK(request.body?.topK);

    try {
      const result = await retrieveSources({
        tenantId,
        query,
        topK
      });

      return reply.send(result);
    } catch (error) {
      request.log.error({ error, tenantId }, "Retrieval query failed");
      return reply.code(500).send({ error: "Failed to retrieve sources" });
    }
  });
};

export default retrievalRoutes;
