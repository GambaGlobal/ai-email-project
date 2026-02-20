import type { CitationPayload } from "@ai-email/shared";
import { queryOne, withTenantClient } from "./db.js";

type CreateGenerationAuditInput = {
  tenantId: string;
  citationPayload: CitationPayload;
  correlationId?: string | null;
};

function toSafeAuditPayload(payload: CitationPayload): CitationPayload {
  return {
    ...payload,
    sources: payload.sources.map((source) => {
      if (source.source_type === "doc_chunk") {
        const { content: _content, ...rest } = source;
        return rest;
      }

      const { answer: _answer, ...rest } = source;
      return rest;
    })
  };
}

export async function createGenerationAudit(input: CreateGenerationAuditInput): Promise<string> {
  const safePayload = toSafeAuditPayload(input.citationPayload);

  return withTenantClient(input.tenantId, async (client) => {
    const row = await queryOne(
      client,
      `
        INSERT INTO generation_audits (
          tenant_id,
          citation_contract_version,
          reason,
          query,
          sources,
          correlation_id
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        RETURNING id
      `,
      [
        input.tenantId,
        safePayload.version,
        safePayload.reason,
        safePayload.query,
        JSON.stringify(safePayload),
        input.correlationId ?? null
      ]
    );

    if (!row || typeof row.id !== "string") {
      throw new Error("Failed to create generation audit");
    }

    return row.id;
  });
}
