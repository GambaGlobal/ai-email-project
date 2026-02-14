const DOCS_INGESTION_JOB_PREFIX = "docs_ingestion";

export const docsIngestionJobId = (docId: string): string => `${DOCS_INGESTION_JOB_PREFIX}-${docId}`;
