export const CITATION_CONTRACT_VERSION = "v1" as const;

export type CitationContractVersion = typeof CITATION_CONTRACT_VERSION;

export type CitationReason = "canonical_qa" | "doc_chunks";

export interface CitationSourceDocChunk {
  source_type: "doc_chunk";
  tenant_id: string;
  chunk_id: string;
  doc_id: string;
  version_id: string;
  chunk_index: number;
  start_char: number;
  end_char: number;
  content_sha256: string;
  excerpt: string;
  content?: string;
  score: number;
}

export interface CitationSourceCanonicalQA {
  source_type: "canonical_qa";
  tenant_id: string;
  canonical_id: string;
  doc_id: string | null;
  version_id: string | null;
  question: string;
  status: "DRAFT" | "APPROVED" | "ARCHIVED";
  excerpt: string;
  answer?: string;
  score: number;
}

export type CitationSource = CitationSourceDocChunk | CitationSourceCanonicalQA;

export interface CitationPayload {
  version: CitationContractVersion;
  query: string;
  reason: CitationReason;
  sources: CitationSource[];
}
