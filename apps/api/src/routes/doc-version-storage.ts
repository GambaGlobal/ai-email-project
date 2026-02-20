import type { FastifyPluginAsync } from "fastify";
import { S3ServiceException } from "@aws-sdk/client-s3";
import { resolveTenantIdFromHeader } from "../lib/tenant.js";
import { buildDocVersionRawPrefix, buildRawDocKey } from "../lib/doc-storage-keys.js";
import { finalizeRawUpload, getTenantDocVersion } from "../lib/doc-version-storage.js";
import {
  createRawDownloadSignedUrl,
  createRawUploadPresignedPost,
  headDocObject,
  resolveDocsBucket
} from "../lib/s3.js";

const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const PRESIGN_SIZE_BUFFER_BYTES = 1024 * 1024;

type PresignBody = {
  filename?: unknown;
  mimeType?: unknown;
  bytes?: unknown;
  sha256?: unknown;
};

type FinalizeBody = {
  key?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  bytes?: unknown;
  sha256?: unknown;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableBytes(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

const docVersionStorageRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { docId: string; versionId: string }; Body: PresignBody }>(
    "/v1/docs/:docId/versions/:versionId/uploads/presign",
    async (request, reply) => {
      const tenantId = resolveTenantIdFromHeader(request);
      if (!tenantId) {
        return reply.code(400).send({ error: "Missing tenant context. Send x-tenant-id header." });
      }

      const filename = asNonEmptyString(request.body?.filename);
      if (!filename) {
        return reply.code(400).send({ error: "filename is required" });
      }

      const docVersion = await getTenantDocVersion(tenantId, request.params.docId, request.params.versionId);
      if (!docVersion) {
        return reply.code(404).send({ error: "Doc version not found" });
      }

      const key = buildRawDocKey({
        tenantId,
        docId: request.params.docId,
        versionId: request.params.versionId,
        filename
      });

      const bytes = asNullableBytes(request.body?.bytes);
      const maxBytes =
        bytes && bytes > 0
          ? Math.max(DEFAULT_MAX_UPLOAD_BYTES, bytes + PRESIGN_SIZE_BUFFER_BYTES)
          : DEFAULT_MAX_UPLOAD_BYTES;

      const presigned = await createRawUploadPresignedPost({
        key,
        maxBytes
      });

      return reply.send({
        url: presigned.url,
        fields: presigned.fields,
        key,
        expiresInSeconds: presigned.expiresInSeconds
      });
    }
  );

  app.post<{ Params: { docId: string; versionId: string }; Body: FinalizeBody }>(
    "/v1/docs/:docId/versions/:versionId/uploads/finalize",
    async (request, reply) => {
      const tenantId = resolveTenantIdFromHeader(request);
      if (!tenantId) {
        return reply.code(400).send({ error: "Missing tenant context. Send x-tenant-id header." });
      }

      const key = asNonEmptyString(request.body?.key);
      const filename = asNonEmptyString(request.body?.filename);
      if (!key || !filename) {
        return reply.code(400).send({ error: "key and filename are required" });
      }

      const docVersion = await getTenantDocVersion(tenantId, request.params.docId, request.params.versionId);
      if (!docVersion) {
        return reply.code(404).send({ error: "Doc version not found" });
      }

      const expectedPrefix = buildDocVersionRawPrefix({
        tenantId,
        docId: request.params.docId,
        versionId: request.params.versionId
      });
      if (!key.startsWith(expectedPrefix)) {
        return reply.code(400).send({ error: "Invalid object key prefix" });
      }

      const expectedKey = buildRawDocKey({
        tenantId,
        docId: request.params.docId,
        versionId: request.params.versionId,
        filename
      });
      if (key !== expectedKey) {
        return reply.code(400).send({ error: "Object key does not match expected key for this filename" });
      }

      const bucket = resolveDocsBucket();
      let headResult: { contentLength: number | null; contentType: string | null };

      try {
        headResult = await headDocObject({ bucket, key });
      } catch (error) {
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
          return reply.code(404).send({ error: "Uploaded object not found in storage" });
        }
        request.log.error({ error, key }, "Failed to verify uploaded object");
        return reply.code(500).send({ error: "Failed to verify uploaded object" });
      }

      const bodyBytes = asNullableBytes(request.body?.bytes);
      const mimeType = asNullableString(request.body?.mimeType) ?? headResult.contentType;
      const sha256 = asNullableString(request.body?.sha256);
      const bytes = bodyBytes ?? headResult.contentLength;

      const finalized = await finalizeRawUpload(tenantId, request.params.docId, request.params.versionId, {
        key,
        filename,
        mimeType,
        bytes,
        sha256
      });

      if (!finalized) {
        return reply.code(404).send({ error: "Doc version not found" });
      }

      return reply.send({
        docId: finalized.docId,
        versionId: finalized.versionId,
        key,
        filename,
        mimeType,
        bytes,
        sha256
      });
    }
  );

  app.get<{ Params: { docId: string; versionId: string }; Querystring: { type?: string } }>(
    "/v1/docs/:docId/versions/:versionId/download",
    async (request, reply) => {
      const tenantId = resolveTenantIdFromHeader(request);
      if (!tenantId) {
        return reply.code(400).send({ error: "Missing tenant context. Send x-tenant-id header." });
      }

      if (request.query.type && request.query.type !== "raw") {
        return reply.code(400).send({ error: "Unsupported download type" });
      }

      const docVersion = await getTenantDocVersion(tenantId, request.params.docId, request.params.versionId);
      if (!docVersion || !docVersion.rawFileKey) {
        return reply.code(404).send({ error: "Raw file not found for doc version" });
      }

      const signed = await createRawDownloadSignedUrl({
        key: docVersion.rawFileKey
      });

      return reply.send({
        url: signed.url,
        expiresInSeconds: signed.expiresInSeconds
      });
    }
  );
};

export default docVersionStorageRoutes;
