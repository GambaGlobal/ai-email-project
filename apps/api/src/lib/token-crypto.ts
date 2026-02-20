import { createCipheriv, randomBytes } from "node:crypto";

type EncryptedValue = {
  ciphertext: string;
  iv: string;
  tag: string;
};

function readEncryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required for Gmail token encryption");
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const base64 = Buffer.from(raw, "base64");
  if (base64.length === 32) {
    return base64;
  }

  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) {
    return utf8;
  }

  throw new Error(
    "TOKEN_ENCRYPTION_KEY must decode to 32 bytes (hex/base64/plain-text) for AES-256-GCM"
  );
}

export function encryptToken(plainText: string): EncryptedValue {
  const key = readEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64")
  };
}
