import type { FastifyPluginAsync } from "fastify";
import { createGenerationAudit } from "../lib/generation-audits.js";
import { generatePreviewDraft } from "../lib/openai-responses.js";
import { resolveTopK, retrieveSources } from "../lib/retrieval.js";
import { resolveTenantIdFromHeader } from "../lib/tenant.js";

type GeneratePreviewBody = {
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

function asOptionalCorrelationId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const generatePreviewRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: GeneratePreviewBody }>("/v1/generate/preview", async (request, reply) => {
    const tenantId = resolveTenantIdFromHeader(request);
    if (!tenantId) {
      return reply.code(400).send({ error: "Missing tenant context. Send x-tenant-id header." });
    }

    const query = asNonEmptyString(request.body?.query);
    if (!query) {
      return reply.code(400).send({ error: "query is required" });
    }

    const topK = asOptionalTopK(request.body?.topK);
    const correlationId = asOptionalCorrelationId(request.headers["x-correlation-id"]);

    try {
      const citationPayload = await retrieveSources({
        tenantId,
        query,
        topK
      });

      const [draftText, auditId] = await Promise.all([
        generatePreviewDraft({
          query,
          citationPayload
        }),
        createGenerationAudit({
          tenantId,
          citationPayload,
          correlationId
        })
      ]);

      return reply.send({
        draft_text: draftText,
        citation_payload: citationPayload,
        audit_id: auditId
      });
    } catch (error) {
      request.log.error({ error, tenantId }, "Generate preview failed");
      return reply.code(500).send({ error: "Failed to generate preview draft" });
    }
  });
};

export default generatePreviewRoutes;
