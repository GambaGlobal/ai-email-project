const DOCS_INGESTION_JOB_PREFIX = "docs_ingestion";
const DOCS_VERSION_INGESTION_JOB_PREFIX = "doc_ingest_v1";

export const DOCS_INGESTION_V1_JOB_NAME = "doc.ingest.v1";

export const docsIngestionJobId = (docId: string): string => `${DOCS_INGESTION_JOB_PREFIX}-${docId}`;

export const docsVersionIngestionJobId = (input: {
  tenantId: string;
  docId: string;
  versionId: string;
}): string =>
  `${DOCS_VERSION_INGESTION_JOB_PREFIX}-${input.tenantId}-${input.docId}-${input.versionId}`;
