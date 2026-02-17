# DR-0018: Phase 13 Retrieval Service (Canonical Q&A First)

## Status
Accepted

## Date
2026-02-17

## Context
- Step 13.4 indexed doc chunks into pgvector and promoted `doc_versions` to `ACTIVE`, but there is no retrieval service yet.
- We need deterministic retrieval behavior that prefers tenant-approved answers when available.
- Step 13.5 requires retrieval output to include source provenance and a stable shape that Step 13.6 can wrap into citations.

## Decision
1. Add tenant-scoped `canonical_qa` as approved, operator-managed Q&A snippets with status lifecycle:
   - `DRAFT`, `APPROVED`, `ARCHIVED`
2. Retrieval strategy is canonical-first:
   - Attempt lexical match on `canonical_qa.question` (`status='APPROVED'` only)
   - Deterministic threshold: all normalized query tokens must appear in `question` (simple `LIKE` predicates)
   - If at least one canonical match exists, return canonical sources first and fill remaining `topK` with `doc_chunks`
   - If no canonical matches exist, use `doc_chunks` only
3. `doc_chunks` retrieval remains pgvector cosine search:
   - embed query with internal OpenAI embeddings adapter
   - search topK by `embedding <=> query_vector`
   - join `doc_versions` and require `state='ACTIVE'`
4. Retrieval response is deterministic and structured:
   - `query`, `reason` (`canonical_qa` or `doc_chunks`), `top_sources[]`
   - each source includes provenance fields needed for citation assembly in Step 13.6

## Consequences
- Operators can lock trusted answers in canonical Q&A and have those preferred immediately.
- Retrieval remains simple, deterministic, and explainable while preserving vector fallback.
- Ranking quality is intentionally basic in v1; future steps can add richer lexical or hybrid scoring without changing endpoint contract.

## References
- `docs/decisions/0017-phase-13-doc-indexing-chunking-embeddings.md`
- `docs/dev/s3-doc-storage.md`
- `docs/dev/retrieval.md`
