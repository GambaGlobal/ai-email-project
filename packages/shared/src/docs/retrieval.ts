export type RetrievalReason = "canonical_qa" | "doc_chunks";

export type RetrievalSourceType = "canonical_qa" | "doc_chunk";

export interface CanonicalQA {
  id: string;
  tenantId: string;
  question: string;
  answer: string;
  status: "DRAFT" | "APPROVED" | "ARCHIVED";
  docId: string | null;
  versionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RetrievalSource {
  source_type: RetrievalSourceType;
  source_id: string;
  tenant_id: string;
  doc_id: string | null;
  version_id: string | null;
  chunk_index: number | null;
  start_char: number | null;
  end_char: number | null;
  content_sha256: string | null;
  excerpt: string;
  content?: string;
  score: number;
}

export interface RetrievalResult {
  query: string;
  reason: RetrievalReason;
  top_sources: RetrievalSource[];
}
