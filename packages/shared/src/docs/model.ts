export const DOC_VERSION_STATES = [
  "UPLOADED",
  "PROCESSING",
  "ACTIVE",
  "ARCHIVED",
  "ERROR"
] as const;

export type DocVersionState = (typeof DOC_VERSION_STATES)[number];

export interface Doc {
  id: string;
  tenantId: string;
  title: string | null;
  docType: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocVersion {
  id: string;
  tenantId: string;
  docId: string;
  versionNumber: number;
  state: DocVersionState;
  sourceFilename: string | null;
  mimeType: string | null;
  bytes: number | null;
  sha256: string | null;
  rawFileKey: string | null;
  extractedTextKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  archivedAt: string | null;
}

export interface DocChunk {
  id: string;
  tenantId: string;
  docId: string;
  versionId: string;
  chunkIndex: number;
  startChar: number;
  endChar: number;
  content: string;
  contentSha256: string;
  embedding: number[];
  createdAt: string;
}

export function isDocVersionState(value: unknown): value is DocVersionState {
  return typeof value === "string" && DOC_VERSION_STATES.includes(value as DocVersionState);
}
