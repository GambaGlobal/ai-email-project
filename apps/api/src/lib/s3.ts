import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

const DEFAULT_PRESIGN_TTL_SECONDS = 300;

export type S3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  presignTtlSeconds: number;
  accessKeyId?: string;
  secretAccessKey?: string;
};

let s3Client: S3Client | null = null;
let resolvedConfig: S3Config | null = null;

function parseOptionalBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function parsePresignTtlSeconds(value: string | undefined): number {
  if (!value) {
    return DEFAULT_PRESIGN_TTL_SECONDS;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("S3_PRESIGN_TTL_SECONDS must be a positive number");
  }

  return Math.floor(parsed);
}

export function loadS3Config(env: NodeJS.ProcessEnv = process.env): S3Config {
  const bucket = env.S3_BUCKET?.trim() ?? env.S3_BUCKET_DOCS?.trim() ?? "";
  const region = env.S3_REGION?.trim() ?? "";
  const endpoint = env.S3_ENDPOINT?.trim() || undefined;
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim() || undefined;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim() || undefined;

  if (!bucket) {
    throw new Error("Missing S3_BUCKET (or S3_BUCKET_DOCS)");
  }

  if (!region) {
    throw new Error("Missing S3_REGION");
  }

  if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
    throw new Error("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together");
  }

  return {
    bucket,
    region,
    endpoint,
    forcePathStyle: parseOptionalBoolean(env.S3_FORCE_PATH_STYLE) || Boolean(endpoint),
    presignTtlSeconds: parsePresignTtlSeconds(env.S3_PRESIGN_TTL_SECONDS),
    accessKeyId,
    secretAccessKey
  };
}

export function getS3Config(): S3Config {
  if (resolvedConfig) {
    return resolvedConfig;
  }

  resolvedConfig = loadS3Config();
  return resolvedConfig;
}

export function validateS3ConfigOnBoot(): void {
  getS3Config();
}

export function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  const config = getS3Config();

  s3Client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
          }
        : undefined
  });

  return s3Client;
}

export function resolveDocsBucket(): string {
  return getS3Config().bucket;
}

export function resolveDocsStorageProvider(): string {
  return "s3";
}

export function toDocsStorageUri(input: { bucket: string; key: string }): string {
  return `s3://${input.bucket}/${input.key}`;
}

export async function putDocObject(input: {
  bucket: string;
  key: string;
  body: Buffer;
  contentType?: string;
}): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType ?? "application/octet-stream"
    })
  );
}

export async function deleteDocObject(input: { bucket: string; key: string }): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: input.bucket,
      Key: input.key
    })
  );
}

export async function headDocObject(input: { bucket: string; key: string }): Promise<{
  contentLength: number | null;
  contentType: string | null;
}> {
  const response = await getS3Client().send(
    new HeadObjectCommand({
      Bucket: input.bucket,
      Key: input.key
    })
  );

  return {
    contentLength:
      typeof response.ContentLength === "number" && Number.isFinite(response.ContentLength)
        ? response.ContentLength
        : null,
    contentType: response.ContentType ?? null
  };
}

export async function createRawUploadPresignedPost(input: {
  key: string;
  maxBytes: number;
  expiresInSeconds?: number;
}): Promise<{
  url: string;
  fields: Record<string, string>;
  expiresInSeconds: number;
}> {
  const config = getS3Config();
  const expiresInSeconds = input.expiresInSeconds ?? config.presignTtlSeconds;
  const post = await createPresignedPost(getS3Client(), {
    Bucket: config.bucket,
    Key: input.key,
    Expires: expiresInSeconds,
    Conditions: [["content-length-range", 1, input.maxBytes]]
  });

  return {
    url: post.url,
    fields: post.fields,
    expiresInSeconds
  };
}

export async function createRawDownloadSignedUrl(input: {
  key: string;
  expiresInSeconds?: number;
}): Promise<{ url: string; expiresInSeconds: number }> {
  const config = getS3Config();
  const expiresInSeconds = input.expiresInSeconds ?? config.presignTtlSeconds;
  const url = await getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: input.key
    }),
    { expiresIn: expiresInSeconds }
  );

  return { url, expiresInSeconds };
}
