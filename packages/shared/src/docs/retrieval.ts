import type { CitationPayload, CitationSource } from "./citations";

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

export type RetrievalSource = CitationSource;

export type RetrievalResult = CitationPayload;
