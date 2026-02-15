import type { PoolClient } from "pg";
import type { Doc, DocVersion, DocVersionState } from "@ai-email/shared";
import { queryOne, withTenantClient } from "./db.js";

type DbRow = Record<string, unknown>;

export type CreateDocInput = {
  title?: string | null;
  docType?: string | null;
  createdBy?: string | null;
};

export type CreateDocVersionInput = {
  state?: DocVersionState;
  sourceFilename?: string | null;
  mimeType?: string | null;
  bytes?: number | null;
  sha256?: string | null;
  rawFileKey?: string | null;
  extractedTextKey?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type SetDocVersionStateInput = {
  activatedAt?: string | null;
  archivedAt?: string | null;
  error?: {
    code?: string | null;
    message?: string | null;
  } | null;
};

export async function createDoc(tenantId: string, input: CreateDocInput): Promise<Doc> {
  return withTenantClient(tenantId, async (client) => {
    const row = await queryOne(
      client,
      `
        INSERT INTO docs (
          tenant_id,
          source,
          title,
          status,
          doc_type,
          created_by
        )
        VALUES (
          $1,
          'upload',
          $2,
          'queued',
          $3,
          $4
        )
        RETURNING id, tenant_id, title, doc_type, created_by, created_at, updated_at
      `,
      [tenantId, input.title ?? null, input.docType ?? null, input.createdBy ?? null]
    );

    if (!row) {
      throw new Error("Failed to create doc");
    }

    return toDoc(row);
  });
}

export async function createDocVersion(
  tenantId: string,
  docId: string,
  payload: CreateDocVersionInput
): Promise<DocVersion> {
  return withTenantClient(tenantId, async (client) => {
    await lockDocRow(client, tenantId, docId);
    const nextVersionNumber = await getNextVersionNumber(client, tenantId, docId);
    const row = await queryOne(
      client,
      `
        INSERT INTO doc_versions (
          tenant_id,
          doc_id,
          version_number,
          state,
          source_filename,
          mime_type,
          bytes,
          sha256,
          raw_file_key,
          extracted_text_key,
          error_code,
          error_message
        )
        VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9, $10, $11, $12
        )
        RETURNING
          id, tenant_id, doc_id, version_number, state, source_filename, mime_type,
          bytes, sha256, raw_file_key, extracted_text_key, error_code, error_message,
          created_at, updated_at, activated_at, archived_at
      `,
      [
        tenantId,
        docId,
        nextVersionNumber,
        payload.state ?? "UPLOADED",
        payload.sourceFilename ?? null,
        payload.mimeType ?? null,
        payload.bytes ?? null,
        payload.sha256 ?? null,
        payload.rawFileKey ?? null,
        payload.extractedTextKey ?? null,
        payload.errorCode ?? null,
        payload.errorMessage ?? null
      ]
    );

    if (!row) {
      throw new Error("Failed to create doc version");
    }

    return toDocVersion(row);
  });
}

export async function setDocVersionState(
  tenantId: string,
  versionId: string,
  nextState: DocVersionState,
  input: SetDocVersionStateInput = {}
): Promise<DocVersion | null> {
  return withTenantClient(tenantId, async (client) => {
    const row = await queryOne(
      client,
      `
        UPDATE doc_versions
        SET
          state = $3,
          activated_at = CASE
            WHEN $3 = 'ACTIVE' THEN COALESCE($4::timestamptz, now())
            ELSE activated_at
          END,
          archived_at = CASE
            WHEN $3 = 'ARCHIVED' THEN COALESCE($5::timestamptz, now())
            ELSE archived_at
          END,
          error_code = CASE
            WHEN $3 = 'ERROR' THEN $6
            ELSE error_code
          END,
          error_message = CASE
            WHEN $3 = 'ERROR' THEN $7
            ELSE error_message
          END,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
        RETURNING
          id, tenant_id, doc_id, version_number, state, source_filename, mime_type,
          bytes, sha256, raw_file_key, extracted_text_key, error_code, error_message,
          created_at, updated_at, activated_at, archived_at
      `,
      [
        tenantId,
        versionId,
        nextState,
        input.activatedAt ?? null,
        input.archivedAt ?? null,
        input.error?.code ?? null,
        input.error?.message ?? null
      ]
    );

    return row ? toDocVersion(row) : null;
  });
}

export async function getActiveDocVersion(tenantId: string, docId: string): Promise<DocVersion | null> {
  return withTenantClient(tenantId, async (client) => {
    const row = await queryOne(
      client,
      `
        SELECT
          id, tenant_id, doc_id, version_number, state, source_filename, mime_type,
          bytes, sha256, raw_file_key, extracted_text_key, error_code, error_message,
          created_at, updated_at, activated_at, archived_at
        FROM doc_versions
        WHERE tenant_id = $1
          AND doc_id = $2
          AND state = 'ACTIVE'
      `,
      [tenantId, docId]
    );

    return row ? toDocVersion(row) : null;
  });
}

export async function listDocVersions(tenantId: string, docId: string): Promise<DocVersion[]> {
  return withTenantClient(tenantId, async (client) => {
    const result = await client.query(
      `
        SELECT
          id, tenant_id, doc_id, version_number, state, source_filename, mime_type,
          bytes, sha256, raw_file_key, extracted_text_key, error_code, error_message,
          created_at, updated_at, activated_at, archived_at
        FROM doc_versions
        WHERE tenant_id = $1
          AND doc_id = $2
        ORDER BY version_number DESC
      `,
      [tenantId, docId]
    );

    return result.rows.map((row) => toDocVersion(row as DbRow));
  });
}

async function lockDocRow(client: PoolClient, tenantId: string, docId: string): Promise<void> {
  const row = await queryOne(
    client,
    `
      SELECT id
      FROM docs
      WHERE tenant_id = $1
        AND id = $2
      FOR UPDATE
    `,
    [tenantId, docId]
  );

  if (!row) {
    throw new Error("Doc not found");
  }
}

async function getNextVersionNumber(client: PoolClient, tenantId: string, docId: string): Promise<number> {
  const row = await queryOne(
    client,
    `
      SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version_number
      FROM doc_versions
      WHERE tenant_id = $1
        AND doc_id = $2
    `,
    [tenantId, docId]
  );

  const nextVersion = row ? Number(row.next_version_number) : NaN;
  if (!Number.isFinite(nextVersion) || nextVersion < 1) {
    throw new Error("Unable to compute next doc version number");
  }

  return nextVersion;
}

function toDoc(row: DbRow): Doc {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    title: asNullableString(row.title),
    docType: asNullableString(row.doc_type),
    createdBy: asNullableString(row.created_by),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at)
  };
}

function toDocVersion(row: DbRow): DocVersion {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    docId: String(row.doc_id),
    versionNumber: Number(row.version_number),
    state: String(row.state) as DocVersionState,
    sourceFilename: asNullableString(row.source_filename),
    mimeType: asNullableString(row.mime_type),
    bytes: asNullableNumber(row.bytes),
    sha256: asNullableString(row.sha256),
    rawFileKey: asNullableString(row.raw_file_key),
    extractedTextKey: asNullableString(row.extracted_text_key),
    errorCode: asNullableString(row.error_code),
    errorMessage: asNullableString(row.error_message),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
    activatedAt: asNullableIsoString(row.activated_at),
    archivedAt: asNullableIsoString(row.archived_at)
  };
}

function asIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  return new Date().toISOString();
}

function asNullableIsoString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return asIsoString(value);
}

function asNullableString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return String(value);
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
