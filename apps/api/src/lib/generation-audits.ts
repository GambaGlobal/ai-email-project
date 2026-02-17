import type { CitationPayload } from "@ai-email/shared";
import { queryOne, withTenantClient } from "./db.js";

type CreateGenerationAuditInput = {
  tenantId: string;
  citationPayload: CitationPayload;
  correlationId?: string | null;
};

export async function createGenerationAudit(input: CreateGenerationAuditInput): Promise<string> {
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
        input.citationPayload.version,
        input.citationPayload.reason,
        input.citationPayload.query,
        JSON.stringify(input.citationPayload),
        input.correlationId ?? null
      ]
    );

    if (!row || typeof row.id !== "string") {
      throw new Error("Failed to create generation audit");
    }

    return row.id;
  });
}
