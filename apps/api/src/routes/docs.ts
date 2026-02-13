import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { asCorrelationId, newCorrelationId } from "@ai-email/shared";
import { resolveTenantIdFromHeader } from "../lib/tenant.js";
import { queryOne, withTenantClient } from "../lib/db.js";
import {
  deleteDocObject,
  putDocObject,
  resolveDocsBucket,
  resolveDocsStorageProvider,
  toDocsStorageUri
} from "../lib/s3.js";
import { enqueueDocIngestion } from "../lib/docs-queue.js";
import { toPubsubIdentifiers, toStructuredLogContext, toStructuredLogEvent } from "../logging.js";

// Expected API env for docs upload (storage mode auto-falls back to local when no S3 bucket env is set):
// DOCS_STORAGE ("s3" | "local"), DOCS_LOCAL_DIR (optional when local),
// S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_DOCS (or S3_BUCKET),
// plus REDIS_URL for BullMQ enqueueing.
const DOC_CATEGORIES = ["Policies", "Itineraries", "FAQs", "Packing"] as const;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type DocCategory = (typeof DOC_CATEGORIES)[number];
type DocStatus = "queued" | "indexing" | "ready" | "failed";
type ErrorWithCode = Error & { code?: string };

type DocRecord = {
  id: string;
  filename: string;
  size: number;
  category: DocCategory;
  status: DocStatus;
  error_message: string | null;
  added_at: string;
  indexed_at: string | null;
  updated_at: string;
};

function isValidCategory(value: unknown): value is DocCategory {
  return typeof value === "string" && DOC_CATEGORIES.includes(value as DocCategory);
}

function toDocRecord(row: Record<string, unknown>): DocRecord {
  return {
    id: String(row.id),
    filename: String(row.filename ?? ""),
    size: Number(row.size_bytes ?? 0),
    category: String(row.category ?? "Policies") as DocCategory,
    status: String(row.status ?? "queued") as DocStatus,
    error_message: typeof row.error_message === "string" ? row.error_message : null,
    added_at: formatTs(row.created_at),
    indexed_at: formatNullableTs(row.indexed_at),
    updated_at: formatTs(row.updated_at)
  };
}

function formatTs(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return new Date().toISOString();
}

function formatNullableTs(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return null;
}

function resolveMailboxIdFromHeader(headers: Record<string, unknown>): string | undefined {
  const mailboxHeader = headers["x-mailbox-id"];
  return typeof mailboxHeader === "string" ? mailboxHeader : undefined;
}

function resolveCorrelationIdFromHeader(headers: Record<string, unknown>) {
  const correlationHeader = headers["x-correlation-id"];
  if (typeof correlationHeader === "string" && correlationHeader.trim().length > 0) {
    return asCorrelationId(correlationHeader);
  }
  return newCorrelationId();
}

function resolveMultipartFieldValue(
  field: unknown
): string | undefined {
  const normalized = Array.isArray(field) ? field[0] : field;
  if (!normalized || typeof normalized !== "object" || !("value" in normalized)) {
    return undefined;
  }
  return typeof normalized.value === "string" ? normalized.value : undefined;
}

function toSafeStack(error: unknown): string | undefined {
  if (!(error instanceof Error) || typeof error.stack !== "string") {
    return undefined;
  }
  return error.stack.split("\n").slice(0, 6).join("\n");
}

function logDocRecordError(
  request: FastifyRequest,
  input: {
    tenantId: string;
    correlationId: string;
    error: unknown;
    message: string;
  }
): void {
  const typedError = input.error as ErrorWithCode;
  const payload = {
    tenantId: input.tenantId,
    correlationId: input.correlationId,
    errorMessage: typedError?.message,
    errorCode: typedError?.code,
    errorStack: toSafeStack(input.error)
  };

  request.log.error(payload, input.message);
  // eslint-disable-next-line no-console
  console.error(`${input.message}: ${JSON.stringify(payload)}`);
}

async function ensureTenantForDev(tenantId: string): Promise<void> {
  if (process.env.NODE_ENV === "production" || process.env.TENANT_AUTOSEED !== "1") {
    return;
  }

  await withTenantClient(tenantId, async (client) => {
    await client.query(
      `
        INSERT INTO tenants (id, name, status)
        VALUES ($1, $2, 'active')
        ON CONFLICT (id) DO NOTHING
      `,
      [tenantId, "Smoke Tenant"]
    );
  });
}

const docsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/docs", async (request, reply) => {
    const tenantId = resolveTenantIdFromHeader(request);
    if (!tenantId) {
      return reply.code(400).send({ error: "Missing tenant context. Send x-tenant-id header." });
    }

    let filePart;
    try {
      filePart = await request.file();
    } catch (error) {
      request.log.error({ error }, "Failed to parse multipart upload");
      return reply.code(400).send({ error: "Invalid upload payload" });
    }

    if (!filePart) {
      return reply.code(400).send({ error: "Missing file upload" });
    }

    const categoryValue = resolveMultipartFieldValue(filePart.fields.category);

    if (!isValidCategory(categoryValue)) {
      return reply.code(400).send({ error: "Invalid category" });
    }

    const fileBuffer = await filePart.toBuffer();
    if (fileBuffer.byteLength > MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ error: "File exceeds upload size limit" });
    }

    const docId = randomUUID();
    const originalFilename = filePart.filename || "upload.bin";
    const safeFilename = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const bucket = resolveDocsBucket();
    const storageProvider = resolveDocsStorageProvider();
    const storageKey = `tenants/${tenantId}/docs/${docId}/${safeFilename}`;
    const correlationId = resolveCorrelationIdFromHeader(request.headers as Record<string, unknown>);
    const mailboxId = resolveMailboxIdFromHeader(request.headers as Record<string, unknown>);
    const stage = "doc_ingestion";
    const queueName = "docs_ingestion";
    const baseLogContext = toStructuredLogContext({
      tenantId,
      mailboxId,
      provider: "other",
      stage,
      queueName,
      correlationId
    });

    request.log.info(
      toStructuredLogEvent(baseLogContext, "notification.received", {
        ...toPubsubIdentifiers(request.headers as Record<string, unknown>)
      }),
      "Docs ingestion notification received"
    );

    try {
      await putDocObject({
        bucket,
        key: storageKey,
        body: fileBuffer,
        contentType: filePart.mimetype
      });
    } catch (error) {
      request.log.error({ error }, "Failed to upload doc object");
      return reply.code(500).send({ error: "Unable to store uploaded document" });
    }

    try {
      await ensureTenantForDev(tenantId);
    } catch (error) {
      logDocRecordError(request, {
        tenantId,
        correlationId,
        error,
        message: "Failed to auto-seed tenant for local docs ingestion"
      });
      return reply.code(500).send({ error: "Unable to create document record" });
    }

    let createdRow: Record<string, unknown> | null = null;

    try {
      await withTenantClient(tenantId, async (client) => {
        createdRow = await queryOne(
          client,
          `
            INSERT INTO docs (
              id,
              tenant_id,
              source,
              title,
              filename,
              size_bytes,
              category,
              status,
              storage_provider,
              storage_key,
              storage_uri,
              metadata,
              created_at,
              updated_at
            )
            VALUES (
              $1,
              $2,
              'upload',
              $3,
              $3,
              $4,
              $5,
              'queued',
              $6,
              $7,
              $8,
              '{}'::jsonb,
              now(),
              now()
            )
            RETURNING *
          `,
          [
            docId,
            tenantId,
            originalFilename,
            fileBuffer.byteLength,
            categoryValue,
            storageProvider,
            storageKey,
            toDocsStorageUri({ bucket, key: storageKey })
          ]
        );
      });
    } catch (error) {
      logDocRecordError(request, {
        tenantId,
        correlationId,
        error,
        message: "Failed to persist doc record"
      });
      return reply.code(500).send({ error: "Unable to create document record" });
    }

    if (!createdRow) {
      logDocRecordError(request, {
        tenantId,
        correlationId,
        error: new Error("INSERT INTO docs returned no row"),
        message: "Persisted doc record returned empty result"
      });
      return reply.code(500).send({ error: "Unable to create document record" });
    }

    try {
      const queued = await enqueueDocIngestion({
        tenantId,
        mailboxId,
        provider: "other",
        stage,
        correlationId,
        docId,
        bucket,
        storageKey,
        category: categoryValue
      });

      request.log.info(
        toStructuredLogEvent(
          {
            ...baseLogContext,
            jobId: queued.jobId,
            correlationId: queued.correlationId
          },
          "notification.enqueued"
        ),
        "Docs ingestion notification enqueued"
      );
    } catch (error) {
      request.log.error({ error, docId }, "Failed to enqueue docs ingestion");
      return reply.code(500).send({ error: "Unable to enqueue document ingestion" });
    }

    return reply.code(201).send(toDocRecord(createdRow));
  });

  app.get("/v1/docs", async (request, reply) => {
    const tenantId = resolveTenantIdFromHeader(request);
    if (!tenantId) {
      return reply.code(400).send({ error: "Missing tenant context. Send x-tenant-id header." });
    }

    try {
      const rows = await withTenantClient(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              id,
              filename,
              size_bytes,
              category,
              status,
              error_message,
              indexed_at,
              created_at,
              updated_at
            FROM docs
            WHERE tenant_id = $1
            ORDER BY created_at DESC
          `,
          [tenantId]
        );

        return result.rows as Record<string, unknown>[];
      });

      return reply.send(rows.map((row) => toDocRecord(row)));
    } catch (error) {
      request.log.error({ error }, "Failed to list docs");
      return reply.code(500).send({ error: "Unable to fetch docs" });
    }
  });

  app.patch<{ Params: { id: string }; Body: { category?: unknown } }>(
    "/v1/docs/:id",
    async (request, reply) => {
      const tenantId = resolveTenantIdFromHeader(request);
      if (!tenantId) {
        return reply.code(400).send({ error: "Missing tenant context. Send x-tenant-id header." });
      }

      if (!isValidCategory(request.body?.category)) {
        return reply.code(400).send({ error: "Invalid category" });
      }

      try {
        const updated = await withTenantClient(tenantId, async (client) => {
          return queryOne(
            client,
            `
              UPDATE docs
              SET category = $3,
                  updated_at = now()
              WHERE tenant_id = $1
                AND id = $2
              RETURNING id, filename, size_bytes, category, status, error_message, indexed_at, created_at, updated_at
            `,
            [tenantId, request.params.id, request.body.category]
          );
        });

        if (!updated) {
          return reply.code(404).send({ error: "Document not found" });
        }

        return reply.send(toDocRecord(updated));
      } catch (error) {
        request.log.error({ error }, "Failed to update doc category");
        return reply.code(500).send({ error: "Unable to update doc" });
      }
    }
  );

  app.delete<{ Params: { id: string } }>("/v1/docs/:id", async (request, reply) => {
    const tenantId = resolveTenantIdFromHeader(request);
    if (!tenantId) {
      return reply.code(400).send({ error: "Missing tenant context. Send x-tenant-id header." });
    }

    try {
      const docToDelete = await withTenantClient(tenantId, async (client) => {
        const row = await queryOne(
          client,
          `
            SELECT id, storage_key
            FROM docs
            WHERE tenant_id = $1
              AND id = $2
          `,
          [tenantId, request.params.id]
        );

        if (!row) {
          return null;
        }

        await client.query(
          `
            DELETE FROM docs
            WHERE tenant_id = $1
              AND id = $2
          `,
          [tenantId, request.params.id]
        );

        return row;
      });

      if (!docToDelete) {
        return reply.code(404).send({ error: "Document not found" });
      }

      try {
        const storageKey =
          typeof docToDelete.storage_key === "string" ? docToDelete.storage_key : null;
        if (storageKey) {
          await deleteDocObject({
            bucket: resolveDocsBucket(),
            key: storageKey
          });
        }
      } catch (error) {
        request.log.error({ error }, "Best-effort S3 delete failed");
      }

      return reply.code(204).send();
    } catch (error) {
      request.log.error({ error }, "Failed to delete doc");
      return reply.code(500).send({ error: "Unable to delete doc" });
    }
  });

  app.post<{ Params: { id: string } }>("/v1/docs/:id/retry", async (request, reply) => {
    const tenantId = resolveTenantIdFromHeader(request);
    if (!tenantId) {
      return reply.code(400).send({ error: "Missing tenant context. Send x-tenant-id header." });
    }

    try {
      const retried = await withTenantClient(tenantId, async (client) => {
        const updated = await queryOne(
          client,
          `
            UPDATE docs
            SET
              status = 'queued',
              error_message = NULL,
              indexed_at = NULL,
              updated_at = now()
            WHERE tenant_id = $1
              AND id = $2
            RETURNING id, filename, size_bytes, category, status, error_message, indexed_at, created_at, updated_at, storage_key
          `,
          [tenantId, request.params.id]
        );

        return updated;
      });

      if (!retried) {
        return reply.code(404).send({ error: "Document not found" });
      }

      const storageKey = typeof retried.storage_key === "string" ? retried.storage_key : null;
      if (!storageKey) {
        request.log.error({ docId: request.params.id }, "Retry missing storage key");
        return reply.code(500).send({ error: "Document storage pointer missing" });
      }

      const correlationId = resolveCorrelationIdFromHeader(request.headers as Record<string, unknown>);
      const mailboxId = resolveMailboxIdFromHeader(request.headers as Record<string, unknown>);
      const stage = "doc_ingestion";
      const queueName = "docs_ingestion";
      const baseLogContext = toStructuredLogContext({
        tenantId,
        mailboxId,
        provider: "other",
        stage,
        queueName,
        correlationId
      });

      request.log.info(
        toStructuredLogEvent(baseLogContext, "notification.received", {
          ...toPubsubIdentifiers(request.headers as Record<string, unknown>)
        }),
        "Docs retry notification received"
      );

      const queued = await enqueueDocIngestion({
        tenantId,
        mailboxId,
        provider: "other",
        stage,
        correlationId,
        docId: String(retried.id),
        bucket: resolveDocsBucket(),
        storageKey,
        category: String(retried.category)
      });

      request.log.info(
        toStructuredLogEvent(
          {
            ...baseLogContext,
            jobId: queued.jobId,
            correlationId: queued.correlationId
          },
          "notification.enqueued"
        ),
        "Docs retry notification enqueued"
      );

      return reply.send(toDocRecord(retried));
    } catch (error) {
      request.log.error({ error }, "Failed to retry doc ingestion");
      return reply.code(500).send({ error: "Unable to retry doc ingestion" });
    }
  });
};

export default docsRoutes;
