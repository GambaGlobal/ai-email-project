# DR-0019: Phase 13 Citation Payload Contract + Audit v1

## Status
Accepted

## Date
2026-02-17

## Context
- Step 13.5 introduced retrieval sources but contract enforcement into generation and storage was not frozen.
- Trust and explainability require deterministic source schema continuity from retrieval -> generation -> audit.
- We need a minimal endpoint to validate this path before full Gmail draft-thread integration.

## Decision
1. Freeze citation payload contract `v1` in shared types:
   - `CitationPayload { version, query, reason, sources[] }`
   - typed source union: `doc_chunk` and `canonical_qa`
2. Retrieval endpoint must return `CitationPayload` directly, including `version`.
3. Add `generation_audits` table (tenant-scoped + RLS) for persisted evidence:
   - `citation_contract_version`, `reason`, `query`, `sources jsonb`, optional `correlation_id`, `created_at`
4. Add temporary validation endpoint `POST /v1/generate/preview`:
   - runs retrieval
   - calls internal OpenAI Responses wrapper using only query + citation payload sources
   - persists one audit row
   - returns `draft_text`, `citation_payload`, `audit_id`

## Consequences
- Citation schema is now versioned and stable for downstream UX/workflow work.
- Every preview generation call is traceable to stored source payloads.
- Preview endpoint is intentionally minimal and not a replacement for final Gmail writeback flow.

## References
- `packages/shared/src/docs/citations.ts`
- `docs/dev/retrieval.md`
- `docs/dev/citations.md`
