import { randomUUID } from "node:crypto";
import type { CorrelationId } from "@ai-email/shared";

const DOCS_INGESTION_JOB_PREFIX = "docs_ingestion";
const DOCS_VERSION_INGESTION_JOB_PREFIX = "doc_ingest_v1";
const DOCS_VERSION_INDEXING_JOB_PREFIX = "doc_index_v1";
const DEFAULT_JOB_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_MS = 500;

export const CITATION_CONTRACT_VERSION = "v1" as const;

export const DEFAULT_BULLMQ_JOB_OPTIONS = {
  attempts: DEFAULT_JOB_ATTEMPTS,
  backoff: {
    type: "exponential",
    delay: DEFAULT_BACKOFF_BASE_MS
  },
  removeOnComplete: 1000,
  removeOnFail: 5000
} as const;

export const DOCS_INGESTION_V1_JOB_NAME = "doc.ingest.v1";
export const DOCS_INDEXING_V1_JOB_NAME = "doc.index.v1";

export const docsIngestionJobId = (docId: string): string => `${DOCS_INGESTION_JOB_PREFIX}-${docId}`;

export const docsVersionIngestionJobId = (input: {
  tenantId: string;
  docId: string;
  versionId: string;
}): string =>
  `${DOCS_VERSION_INGESTION_JOB_PREFIX}-${input.tenantId}-${input.docId}-${input.versionId}`;

export const docsVersionIndexingJobId = (input: {
  tenantId: string;
  docId: string;
  versionId: string;
}): string => `${DOCS_VERSION_INDEXING_JOB_PREFIX}-${input.tenantId}-${input.docId}-${input.versionId}`;

export const asCorrelationId = (value: string): CorrelationId => value as CorrelationId;
export const newCorrelationId = (): CorrelationId => asCorrelationId(randomUUID());

export const KILL_SWITCH_DOCS_INGESTION = "docs_ingestion";
export const ENV_DOCS_INGESTION_DISABLED = "DOCS_INGESTION_DISABLED";
export const KILL_SWITCH_MAIL_NOTIFICATIONS = "mail_notifications";
export const KILL_SWITCH_MAILBOX_SYNC = "mailbox_sync";
export const ENV_MAIL_NOTIFICATIONS_DISABLED = "MAIL_NOTIFICATIONS_DISABLED";
export const ENV_MAILBOX_SYNC_DISABLED = "MAILBOX_SYNC_DISABLED";

function isTruthyEnv(value?: string): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isGlobalDocsIngestionDisabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isTruthyEnv(env[ENV_DOCS_INGESTION_DISABLED]);
}

export function isGlobalMailNotificationsDisabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isTruthyEnv(env[ENV_MAIL_NOTIFICATIONS_DISABLED]);
}

export function isGlobalMailboxSyncDisabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isTruthyEnv(env[ENV_MAILBOX_SYNC_DISABLED]);
}
