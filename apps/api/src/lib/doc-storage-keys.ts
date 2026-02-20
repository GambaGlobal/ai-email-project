const FILENAME_MAX_LENGTH = 120;
const DEFAULT_FILENAME = "upload.bin";
const UNICODE_SLASHES = /[\/\\\u2044\u2215\u29F8\uFF0F]/g;

function sanitizeExtension(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, 16);
}

function sanitizeStem(value: string): string {
  const stripped = value
    .replace(UNICODE_SLASHES, " ")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const ascii = stripped
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");

  return ascii || "file";
}

export function sanitizeDocFilename(filename: string): string {
  const normalized = typeof filename === "string" ? filename.trim() : "";
  const baseValue = normalized.length > 0 ? normalized : DEFAULT_FILENAME;
  const lastDot = baseValue.lastIndexOf(".");
  const hasExtension = lastDot > 0 && lastDot < baseValue.length - 1;

  const rawStem = hasExtension ? baseValue.slice(0, lastDot) : baseValue;
  const rawExtension = hasExtension ? baseValue.slice(lastDot + 1) : "";

  const stem = sanitizeStem(rawStem);
  const extension = sanitizeExtension(rawExtension);

  if (!extension) {
    return stem.slice(0, FILENAME_MAX_LENGTH);
  }

  const availableStemLength = Math.max(FILENAME_MAX_LENGTH - extension.length - 1, 1);
  return `${stem.slice(0, availableStemLength)}.${extension}`;
}

export function buildRawDocKey(input: {
  tenantId: string;
  docId: string;
  versionId: string;
  filename: string;
}): string {
  const safeFilename = sanitizeDocFilename(input.filename);
  return `tenants/${input.tenantId}/docs/${input.docId}/versions/${input.versionId}/raw/${safeFilename}`;
}

export function buildDocVersionRawPrefix(input: {
  tenantId: string;
  docId: string;
  versionId: string;
}): string {
  return `tenants/${input.tenantId}/docs/${input.docId}/versions/${input.versionId}/raw/`;
}
