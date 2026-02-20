# DR-0017: Phase 13 Doc Indexing (Chunking + Embeddings + pgvector)

## Status
Accepted

## Date
2026-02-15

## Context
- Step 13.3 produces deterministic extracted text artifacts in S3 but retrieval is not yet possible.
- We need tenant-safe, idempotent indexing into Postgres/pgvector before retrieval steps.
- State semantics must remain clear for operators and retrieval logic.

## Decision
1. Add `doc_chunks` as the canonical indexed chunk table for `doc_versions` with provenance:
   - `tenant_id`, `doc_id`, `version_id`, `chunk_index`
   - `start_char`, `end_char`, `content`, `content_sha256`
   - `embedding vector(1536)`
2. Add worker job `doc.index.v1` in queue `docs_ingestion` with payload:
   - `tenantId`, `docId`, `versionId`, `correlationId`
3. Chunking strategy is deterministic:
   - target ~800 tokens (~3200 chars)
   - overlap ~100 tokens (~400 chars)
   - paragraph boundary preference with fixed-window fallback
4. Embedding model choice:
   - `text-embedding-3-small` (1536 dims) via OpenAI embeddings API in worker adapter
5. Idempotency strategy:
   - transactional delete-and-replace of all `doc_chunks` rows for `(tenant_id, version_id)`
6. State transition decision:
   - set `doc_versions.state = ACTIVE` after successful indexing
   - archive any previous active versions for the same doc

## Consequences
- `ACTIVE` now means retrieval-ready (extracted + indexed).
- Re-indexing the same version is safe and deterministic.
- Raw customer documents remain in S3; no OpenAI Files/Vector Stores usage.

## References
- `docs/decisions/0014-phase-13-doc-model-versioning-states.md`
- `docs/decisions/0015-phase-13-s3-system-of-record-presigned-uploads.md`
- `docs/decisions/0016-phase-13-doc-ingestion-extraction-v1.md`
- `docs/dev/s3-doc-storage.md`
