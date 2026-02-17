import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { RetrievalResult, RetrievalSource } from "@ai-email/shared";
import { withTenantClient } from "./db.js";
import { embedTexts } from "./openai-embeddings.js";

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;
const MAX_CANONICAL_RESULTS = 3;
const MAX_CANONICAL_QUERY_TOKENS = 10;

type CanonicalQaRow = {
  id: string;
  tenant_id: string;
  doc_id: string | null;
  version_id: string | null;
  question: string;
  answer: string;
};

type DocChunkRow = {
  id: string;
  tenant_id: string;
  doc_id: string;
  version_id: string;
  chunk_index: number;
  start_char: number;
  end_char: number;
  content: string;
  content_sha256: string;
  distance: number;
};

type NormalizedQuery = {
  raw: string;
  normalized: string;
  tokens: string[];
};

export type RetrieveSourcesInput = {
  tenantId: string;
  query: string;
  topK?: number;
};

export function resolveTopK(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) {
    return DEFAULT_TOP_K;
  }
  const parsed = Math.trunc(value);
  if (parsed <= 0) {
    return DEFAULT_TOP_K;
  }
  return Math.min(parsed, MAX_TOP_K);
}

export function normalizeQuery(query: string): NormalizedQuery {
  const normalized = query.trim().toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
  const uniqueTokens = new Set<string>();

  for (const token of normalized.split(" ")) {
    if (token.length > 0) {
      uniqueTokens.add(token);
    }
  }

  return {
    raw: query,
    normalized,
    tokens: [...uniqueTokens]
  };
}

export async function retrieveSources(input: RetrieveSourcesInput): Promise<RetrievalResult> {
  const topK = resolveTopK(input.topK);
  const normalizedQuery = normalizeQuery(input.query);
  const canonicalSources = await retrieveCanonicalQA(input.tenantId, normalizedQuery, topK);

  if (canonicalSources.length > 0) {
    const remaining = Math.max(topK - canonicalSources.length, 0);
    const fallbackSources = remaining > 0 ? await retrieveDocChunks(input.tenantId, normalizedQuery.raw, remaining) : [];

    return {
      query: normalizedQuery.raw,
      reason: "canonical_qa",
      top_sources: [...canonicalSources, ...fallbackSources].slice(0, topK)
    };
  }

  const chunkSources = await retrieveDocChunks(input.tenantId, normalizedQuery.raw, topK);
  return {
    query: normalizedQuery.raw,
    reason: "doc_chunks",
    top_sources: chunkSources
  };
}

async function retrieveCanonicalQA(
  tenantId: string,
  query: NormalizedQuery,
  topK: number
): Promise<RetrievalSource[]> {
  const tokens = query.tokens.slice(0, MAX_CANONICAL_QUERY_TOKENS);
  if (tokens.length === 0) {
    return [];
  }

  return withTenantClient(tenantId, async (client) => {
    const candidates = await fetchCanonicalCandidates(client, tenantId, query.normalized, tokens, topK);
    return candidates.map((row) => {
      const answerSha = createHash("sha256").update(row.answer).digest("hex");
      const score = computeCanonicalScore(query.normalized, query.tokens, row.question);
      return {
        source_type: "canonical_qa",
        source_id: row.id,
        tenant_id: row.tenant_id,
        doc_id: row.doc_id,
        version_id: row.version_id,
        chunk_index: null,
        start_char: null,
        end_char: null,
        content_sha256: answerSha,
        content: row.answer,
        excerpt: row.answer.slice(0, 500),
        score
      } satisfies RetrievalSource;
    });
  });
}

async function fetchCanonicalCandidates(
  client: PoolClient,
  tenantId: string,
  normalizedQueryText: string,
  tokens: string[],
  topK: number
): Promise<CanonicalQaRow[]> {
  const params: unknown[] = [tenantId, normalizedQueryText];
  const tokenPredicates: string[] = [];

  for (const token of tokens) {
    params.push(`%${token}%`);
    tokenPredicates.push(`lower(question) LIKE $${params.length}`);
  }

  params.push(Math.max(1, Math.min(topK, MAX_CANONICAL_RESULTS)));

  const sql = `
    SELECT
      id,
      tenant_id,
      doc_id,
      version_id,
      question,
      answer
    FROM canonical_qa
    WHERE tenant_id = $1
      AND status = 'APPROVED'
      ${tokenPredicates.length > 0 ? `AND ${tokenPredicates.join(" AND ")}` : ""}
    ORDER BY
      CASE
        WHEN lower(trim(regexp_replace(question, '\\s+', ' ', 'g'))) = $2 THEN 0
        ELSE 1
      END ASC,
      char_length(question) ASC,
      id ASC
    LIMIT $${params.length}
  `;

  const result = await client.query(sql, params);
  return result.rows as CanonicalQaRow[];
}

function computeCanonicalScore(queryNormalized: string, tokens: string[], question: string): number {
  const normalizedQuestion = normalizeQuery(question);
  if (normalizedQuestion.normalized.length > 0 && normalizedQuestion.normalized === queryNormalized) {
    return 1;
  }

  const matched = tokens.reduce((count, token) => {
    return normalizedQuestion.normalized.includes(token) ? count + 1 : count;
  }, 0);

  if (tokens.length === 0) {
    return 0;
  }

  return Number((matched / tokens.length).toFixed(6));
}

async function retrieveDocChunks(tenantId: string, query: string, topK: number): Promise<RetrievalSource[]> {
  if (topK <= 0) {
    return [];
  }

  const embeddings = await embedTexts({ texts: [query] });
  const queryVector = embeddings.vectors[0];
  if (!queryVector) {
    throw new Error("Query embedding was not generated");
  }

  const vectorValue = `[${queryVector.join(",")}]`;
  return withTenantClient(tenantId, async (client) => {
    const result = await client.query(
      `
        SELECT
          dc.id,
          dc.tenant_id,
          dc.doc_id,
          dc.version_id,
          dc.chunk_index,
          dc.start_char,
          dc.end_char,
          dc.content,
          dc.content_sha256,
          (dc.embedding <=> $2::vector) AS distance
        FROM doc_chunks dc
        INNER JOIN doc_versions dv
          ON dv.tenant_id = dc.tenant_id
         AND dv.id = dc.version_id
        WHERE dc.tenant_id = $1
          AND dv.state = 'ACTIVE'
        ORDER BY
          dc.embedding <=> $2::vector ASC,
          dc.chunk_index ASC,
          dc.id ASC
        LIMIT $3
      `,
      [tenantId, vectorValue, topK]
    );

    return (result.rows as DocChunkRow[]).map((row) => {
      const score = Number(Math.max(0, 1 - Number(row.distance)).toFixed(6));
      return {
        source_type: "doc_chunk",
        source_id: row.id,
        tenant_id: row.tenant_id,
        doc_id: row.doc_id,
        version_id: row.version_id,
        chunk_index: Number(row.chunk_index),
        start_char: Number(row.start_char),
        end_char: Number(row.end_char),
        content_sha256: row.content_sha256,
        content: row.content,
        excerpt: row.content.slice(0, 500),
        score
      } satisfies RetrievalSource;
    });
  });
}
