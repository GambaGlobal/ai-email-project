import { queryOne, withTenantClient } from "./db.js";

type Row = Record<string, unknown>;

export type TenantDocVersion = {
  tenantId: string;
  docId: string;
  versionId: string;
  state: string;
  rawFileKey: string | null;
};

function toTenantDocVersion(row: Row): TenantDocVersion {
  return {
    tenantId: String(row.tenant_id),
    docId: String(row.doc_id),
    versionId: String(row.version_id),
    state: String(row.state),
    rawFileKey: typeof row.raw_file_key === "string" ? row.raw_file_key : null
  };
}

export async function getTenantDocVersion(
  tenantId: string,
  docId: string,
  versionId: string
): Promise<TenantDocVersion | null> {
  return withTenantClient(tenantId, async (client) => {
    const row = await queryOne(
      client,
      `
        SELECT
          dv.tenant_id,
          dv.doc_id,
          dv.id AS version_id,
          dv.state,
          dv.raw_file_key
        FROM doc_versions dv
        JOIN docs d
          ON d.tenant_id = dv.tenant_id
         AND d.id = dv.doc_id
        WHERE dv.tenant_id = $1
          AND dv.doc_id = $2
          AND dv.id = $3
      `,
      [tenantId, docId, versionId]
    );

    return row ? toTenantDocVersion(row) : null;
  });
}

export async function finalizeRawUpload(
  tenantId: string,
  docId: string,
  versionId: string,
  input: {
    key: string;
    filename: string;
    mimeType: string | null;
    bytes: number | null;
    sha256: string | null;
  }
): Promise<TenantDocVersion | null> {
  return withTenantClient(tenantId, async (client) => {
    const row = await queryOne(
      client,
      `
        UPDATE doc_versions
        SET
          raw_file_key = $4,
          source_filename = $5,
          mime_type = $6,
          bytes = $7,
          sha256 = $8,
          updated_at = now()
        WHERE tenant_id = $1
          AND doc_id = $2
          AND id = $3
        RETURNING
          tenant_id,
          doc_id,
          id AS version_id,
          state,
          raw_file_key
      `,
      [tenantId, docId, versionId, input.key, input.filename, input.mimeType, input.bytes, input.sha256]
    );

    return row ? toTenantDocVersion(row) : null;
  });
}
