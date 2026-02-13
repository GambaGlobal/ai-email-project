import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

let s3Client: S3Client | null = null;
const LOCAL_DOCS_BUCKET = "local";
const LOCAL_STORAGE_SCHEME = "file";

export type DocsStorageMode = "s3" | "local";

function normalizeStorageMode(value: string | undefined): DocsStorageMode | null {
  if (value === "s3" || value === "local") {
    return value;
  }
  return null;
}

function resolveDefaultDocsLocalDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolvePath(moduleDir, "../../../../.tmp/docs");
}

function resolveDocsLocalDir(): string {
  if (typeof process.env.DOCS_LOCAL_DIR === "string" && process.env.DOCS_LOCAL_DIR.trim().length > 0) {
    return resolvePath(process.env.DOCS_LOCAL_DIR.trim());
  }
  return resolveDefaultDocsLocalDir();
}

function getS3BucketName(): string {
  return process.env.S3_BUCKET_DOCS ?? process.env.S3_BUCKET ?? "";
}

export function resolveDocsStorageMode(): DocsStorageMode {
  const explicitMode = normalizeStorageMode(process.env.DOCS_STORAGE);
  if (explicitMode) {
    return explicitMode;
  }
  return getS3BucketName() ? "s3" : "local";
}

export function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing S3 configuration env for docs storage");
  }

  s3Client = new S3Client({
    region,
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId,
      secretAccessKey
    },
    forcePathStyle: Boolean(process.env.S3_ENDPOINT)
  });

  return s3Client;
}

export function resolveDocsBucket(): string {
  if (resolveDocsStorageMode() === "local") {
    return LOCAL_DOCS_BUCKET;
  }

  const bucket = getS3BucketName();

  if (!bucket) {
    throw new Error("Missing docs bucket env (S3_BUCKET_DOCS or S3_BUCKET)");
  }

  return bucket;
}

export function resolveDocsStorageProvider(): string {
  return resolveDocsStorageMode();
}

export function toDocsStorageUri(input: { bucket: string; key: string }): string {
  if (resolveDocsStorageMode() === "local") {
    const localRoot = resolveDocsLocalDir();
    return `${LOCAL_STORAGE_SCHEME}://${resolvePath(localRoot, input.key)}`;
  }

  return `s3://${input.bucket}/${input.key}`;
}

export async function putDocObject(input: {
  bucket: string;
  key: string;
  body: Buffer;
  contentType?: string;
}): Promise<void> {
  if (resolveDocsStorageMode() === "local") {
    const targetPath = resolvePath(resolveDocsLocalDir(), input.key);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, input.body);
    return;
  }

  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType ?? "application/octet-stream"
    })
  );
}

export async function deleteDocObject(input: { bucket: string; key: string }): Promise<void> {
  if (resolveDocsStorageMode() === "local") {
    const targetPath = resolvePath(resolveDocsLocalDir(), input.key);
    try {
      await unlink(targetPath);
    } catch (error) {
      const typedError = error as NodeJS.ErrnoException;
      if (typedError.code !== "ENOENT") {
        throw error;
      }
    }
    return;
  }

  const client = getS3Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket: input.bucket,
      Key: input.key
    })
  );
}
