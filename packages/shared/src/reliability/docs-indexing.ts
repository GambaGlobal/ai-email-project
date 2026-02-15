const DOCS_VERSION_INDEXING_JOB_PREFIX = "doc_index_v1";

export const DOCS_INDEXING_V1_JOB_NAME = "doc.index.v1";

export const docsVersionIndexingJobId = (input: {
  tenantId: string;
  docId: string;
  versionId: string;
}): string => `${DOCS_VERSION_INDEXING_JOB_PREFIX}-${input.tenantId}-${input.docId}-${input.versionId}`;
