# DR-0005: Phase 7 — Knowledge Ingestion & Retrieval (Trust-First)

## Status
Accepted

## Context
- We must ground drafts in operator-provided knowledge and never invent policy.
- This Decision Record freezes v1 supported doc types, taxonomy/precedence, ingestion artifacts, retrieval/ranking behavior, escalation triggers, and evaluation metrics.
- Phase 7 specifications were completed in Steps 7.2 through 7.7 and are now the canonical basis for Phase 8 implementation.

## Decisions (frozen)
1. Knowledge definition and v1 supported doc types are frozen in `docs/phases/phase-7-knowledge/knowledge-taxonomy-v1.md`.
   - Supported: digital-text PDF, DOCX, TXT/MD, HTML/text paste, structured policy entries.
   - Not supported in v1: scanned/OCR PDFs, website crawling, spreadsheets as first-class documents.

2. Taxonomy + precedence ladder + tie-breakers are frozen in `docs/phases/phase-7-knowledge/knowledge-taxonomy-v1.md`.
   - Categories: `structured_policy`, `terms_policy`, `waiver_release`, `safety_medical`, `trip_itinerary`, `faq`, `packing_list`, `operations_internal`, `marketing`.
   - Precedence order is fixed (`structured_policy` highest, `marketing` lowest).
   - Tie-breakers are fixed: `supersedes` -> `priority` -> `effective_date` -> `last_reviewed_at` -> `human review required`.

3. Required document metadata fields are frozen in `docs/phases/phase-7-knowledge/knowledge-taxonomy-v1.md`.
   - Includes `tenant_id`, `doc_id`, `doc_version_id`, `category`, `priority`, `effective_date`, `last_reviewed_at`, `supersedes_doc_version_id`, `content_hash`, and related audit metadata.

4. Ingestion pipeline lifecycle + idempotency are frozen in `docs/phases/phase-7-knowledge/ingestion-pipeline-v1.md`.
   - Lifecycle includes `received/queued/parsing/parsed/chunking/chunked/embedding/indexed/failed/needs_attention`.
   - Scanned PDF detection routes to `needs_attention` with `PARSE_EMPTY_TEXT_SCAN_DETECTED`.
   - Ingestion idempotency tuple: (`tenant_id`, `doc_version_id`, `parser_version`, `chunker_version`, `embedding_model_id`).
   - Vector upsert uniqueness: (`tenant_id`, `doc_version_id`, `chunk_id`, `embedding_model_id`).

5. Chunking + citations are frozen in `docs/phases/phase-7-knowledge/chunking-and-citations-v1.md`.
   - Default chunk target `500-900` tokens with `10-15%` overlap.
   - Stable `chunk_id` and `source_locator` discipline per `doc_version_id`.
   - Policy-like claims require at least one citation.
   - Citations are operator-visible and not guest-visible by default.

6. Retrieval & ranking behavior is frozen in `docs/phases/phase-7-knowledge/retrieval-and-ranking-v1.md`.
   - Hybrid retrieval with `K_v=24`, `K_l=16`, candidate cap `40`.
   - Tiered precedence enforcement for policy-like claims.
   - Evidence pack size `4-10` (default max `10`).
   - Thresholds: `low_confidence` if top score `< 0.72`; `unknown` if no chunk `>= 0.65`.

7. Conflict/staleness handling + reason codes are frozen in `docs/phases/phase-7-knowledge/conflict-and-staleness-handling-v1.md`.
   - Escalation outcomes fixed: `OK_TO_DRAFT`, `ASK_CLARIFYING_QUESTION`, `NEEDS_REVIEW`, `UNKNOWN`.
   - Sensitive + stale-only evidence -> `NEEDS_REVIEW`.
   - `conflict_detected` -> `NEEDS_REVIEW` for sensitive topics.
   - `exception_request` -> `NEEDS_REVIEW`.
   - Reason codes list is fixed to the v1 set of 10.

8. Unknown handling + evaluation metrics and targets are frozen in `docs/phases/phase-7-knowledge/unknown-and-evaluation-v1.md`.
   - Never assert a policy-like claim without citation.
   - Targets: `Recall@10 >= 0.85`, policy citation coverage `>= 0.95`, unsupported claim rate `<= 0.05`, invented policy incidents `= 0`.

## Consequences
- Implementation must enforce citation discipline and precedence-first grounding.
- Failure to meet evidence or confidence requirements must route to review-oriented outcomes instead of speculative drafting.
- Operators must keep documents reviewed and current; stale-only evidence reduces automation, especially for sensitive topics.
- OCR/crawler ingestion remains intentionally out of v1 to protect trust and reduce brittleness.

## Follow-ups / Deferred
- OCR/scanned PDF ingestion pipeline.
- Connector-based ingestion (websites, Drive, Notion, etc.).
- Per-category chunking tuning beyond v1 default.
- More advanced contradiction detection and resolution workflows.
