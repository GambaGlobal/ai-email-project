import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

let s3Client: S3Client | null = null;

function getS3BucketName(): string {
  return process.env.S3_BUCKET_DOCS ?? process.env.S3_BUCKET ?? "";
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
  const bucket = getS3BucketName();

  if (!bucket) {
    throw new Error("Missing docs bucket env (S3_BUCKET_DOCS or S3_BUCKET)");
  }

  return bucket;
}

export async function putDocObject(input: {
  bucket: string;
  key: string;
  body: Buffer;
  contentType?: string;
}): Promise<void> {
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
  const client = getS3Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket: input.bucket,
      Key: input.key
    })
  );
}
