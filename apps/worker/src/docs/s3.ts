import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const DEFAULT_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

type S3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
};

let resolvedConfig: S3Config | null = null;
let client: S3Client | null = null;

function parseOptionalBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function loadConfig(env: NodeJS.ProcessEnv = process.env): S3Config {
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
    accessKeyId,
    secretAccessKey
  };
}

function getConfig(): S3Config {
  if (resolvedConfig) {
    return resolvedConfig;
  }

  resolvedConfig = loadConfig();
  return resolvedConfig;
}

export function resolveDocsBucket(): string {
  return getConfig().bucket;
}

function getClient(): S3Client {
  if (client) {
    return client;
  }

  const config = getConfig();
  client = new S3Client({
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

  return client;
}

async function streamToBuffer(
  body: unknown,
  maxBytes: number
): Promise<Buffer> {
  if (!body || typeof body !== "object" || !("transformToByteArray" in body)) {
    throw new Error("S3 object body stream missing");
  }

  const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  if (bytes.byteLength > maxBytes) {
    throw new Error(`S3 object exceeds max size (${maxBytes} bytes)`);
  }

  return Buffer.from(bytes);
}

export async function downloadDocObject(input: {
  key: string;
  maxBytes?: number;
}): Promise<{
  body: Buffer;
  contentType: string | null;
  contentLength: number | null;
}> {
  const response = await getClient().send(
    new GetObjectCommand({
      Bucket: resolveDocsBucket(),
      Key: input.key
    })
  );

  const maxBytes = input.maxBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  const body = await streamToBuffer(response.Body, maxBytes);

  return {
    body,
    contentType: response.ContentType ?? null,
    contentLength:
      typeof response.ContentLength === "number" && Number.isFinite(response.ContentLength)
        ? response.ContentLength
        : body.byteLength
  };
}

export async function uploadTextArtifact(input: {
  key: string;
  body: string;
  contentType?: string;
}): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: resolveDocsBucket(),
      Key: input.key,
      Body: Buffer.from(input.body, "utf8"),
      ContentType: input.contentType ?? "text/plain; charset=utf-8"
    })
  );
}
