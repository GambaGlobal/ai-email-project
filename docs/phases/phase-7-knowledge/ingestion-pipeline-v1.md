# Ingestion Pipeline v1 (Upload -> Parse -> Chunk -> Embed -> Index)

## 0) Objectives (trust-first)

- Deterministic, auditable ingestion for every `doc_version_id`.
- Prevent mystery updates through immutable versioning and explicit supersedes links.
- Maintain clear failure states and operator-visible remediation actions.
- Enforce idempotent worker execution so retries are safe.
- Align category, priority, and staleness semantics with `docs/phases/phase-7-knowledge/knowledge-taxonomy-v1.md`.

## 1) Inputs and artifacts

### Inputs (sources)

- Upload (PDF/DOCX/TXT/MD).
- HTML/Text paste.
- Structured policy entries (ingested via form mutations, but still produce doc-like versioned records).

### Stored artifacts (by stage)

| Stage artifact | Default store | Key pointers in DB | Retention expectation |
| --- | --- | --- | --- |
| Raw source file/body | S3 | `tenant_id`, `doc_id`, `doc_version_id`, `source_type`, `raw_object_key`, `content_hash` | Keep all versions in v1; no hard delete. |
| Extracted normalized text | S3 | `extracted_text_object_key`, `parse_status`, `parser_version`, `detected_language` | Keep all version outputs for audit/debug in v1. |
| Chunks (text + metadata) | DB (default) | `chunk_id`, `doc_version_id`, `category`, `token_count`, `section_title`, `page_range`, `policy_likeness_hint` | Keep all chunks for all versions; superseded versions remain queryable for audit. |
| Embeddings + lexical index signals | DB (pgvector + tsvector) | `tenant_id`, `doc_version_id`, `chunk_id`, `embedding_model_id`, `vector`, `lexical_vector` | Keep all embeddings; never delete because a version is superseded. |

Default choice rationale:
- Chunk text is stored in DB in v1 to support deterministic joins, tenant-scoped filtering, and simpler transactional idempotent upserts.
- Raw and extracted full-text artifacts remain in S3 to avoid large object bloat in core relational tables.

## 2) Versioning model

Concepts:
- Document: stable logical source (example: "2026 Terms and Conditions").
- DocumentVersion: immutable snapshot of content and metadata at ingest time, keyed by `doc_version_id` and `content_hash`.

Rules:
- Every upload/paste creates a new `DocumentVersion` unless the same `content_hash` already exists for the same logical document; exact hash duplicate is deduplicated.
- Structured policy entries create a new version whenever content changes, with an explicit change log entry.
- `supersedes_doc_version_id` marks replacement lineage; superseded versions remain stored and auditable.
- Embeddings for superseded versions are retained in v1 (no deletion on supersede).

Retrieval interaction:
- Retrieval excludes superseded versions by default.
- Audit/debug views can include superseded versions on demand.

## 3) Ingestion lifecycle (state machine)

| State | Entry criteria | Outputs produced | Retry behavior | Operator-visible status |
| --- | --- | --- | --- | --- |
| `received` | Version record created and raw source accepted | `doc_version_id`, metadata snapshot, S3 raw key | N/A | "Upload received" |
| `queued` | Ingestion job enqueued with idempotency tuple | Queue job id, enqueue timestamp | Safe to enqueue again with same key (dedupe/converge) | "Queued for processing" |
| `parsing` | Worker claims job and starts parser | Parse attempt record, parser version | Retryable on transient failure | "Extracting text" |
| `parsed` | Extraction completes with sufficient text density | Normalized text artifact pointer, parse stats | N/A | "Text extracted" |
| `chunking` | Parsed text available | Chunking attempt record | Retryable; must overwrite deterministically | "Structuring content" |
| `chunked` | Chunking complete | Chunk rows with stable `chunk_id` values | N/A | "Content structured" |
| `embedding` | Chunk set finalized | Embed attempt record | Retryable with bounded backoff | "Generating search vectors" |
| `indexed` | Vector and lexical index writes complete | Ready-for-retrieval marker | N/A | "Ready" |
| `failed` | Non-recoverable stage error or retries exhausted | Error code + redacted summary + failure stage | Terminal until manual requeue/new version | "Failed" + remediation hint |
| `needs_attention` | Operator action required (example: scan detected) | Attention reason code + guidance | Terminal until operator action | "Needs attention" + action required |

## 4) Stage-by-stage pipeline (implementation-ready)

### 4.1 Upload / Create version

- API captures required metadata from taxonomy spec: `category`, `priority`, `effective_date`, `last_reviewed_at`, plus v1 metadata such as `tenant_id`, `uploaded_by`, `source_type`.
- Store raw artifact in S3 using key pattern: `tenant_id/doc_id/doc_version_id/original.ext`.
- Persist `content_hash` for dedupe checks.
- Enqueue BullMQ ingestion job with idempotency key tuple:
  - (`tenant_id`, `doc_version_id`, `parser_version`, `chunker_version`, `embedding_model_id`).

### 4.2 Parse (extract text)

- PDF (digital text): extract page-aware text; preserve page boundaries when available.
- DOCX: extract headings and paragraph flow; preserve heading hierarchy when available.
- HTML/Text paste: sanitize markup, normalize whitespace/newlines, preserve heading-like blocks.
- Normalization rules:
  - Preserve section headings when detected.
  - Preserve page numbers/page boundaries when parser provides them.
  - Normalize repeated whitespace and control characters.
- Scanned PDF detection (dry-run parse):
  - If extracted text length is below a minimum threshold OR text density is too low for page count, classify as `needs_attention` with reason `scan/OCR not supported v1` and code `PARSE_EMPTY_TEXT_SCAN_DETECTED`.

### 4.3 Chunk

- Taxonomy-aware guidance: policy-heavy categories often benefit from smaller chunks; v1 keeps one default chunking profile for determinism, with future tuning deferred.
- Default chunk spec:
  - Target `~500-900` tokens.
  - Overlap `10-15%`.
  - Prefer heading/section boundaries; fallback to paragraph splitting.
- Required chunk metadata fields:
  - `chunk_id` (stable).
  - `doc_version_id`.
  - `category`.
  - `section_title` / `page_range`.
  - `token_count`.
  - `text`.
  - `policy_likeness_hint` (heuristic tag).
  - `language` (if known).

### 4.4 Embed

- Use OpenAI embeddings through the internal wrapper boundary.
- Embedding model is configurable via `EMBEDDING_MODEL_ID` (default configured in environment, not hardcoded in this spec).
- Retry policy:
  - Bounded retries with exponential backoff.
  - On exhaustion, mark terminal `failed` with stage `embedding`, error code, and redacted message summary (no raw PII/text).

### 4.5 Index (pgvector + lexical fallback)

- Store vector embeddings in pgvector-backed table keyed by `tenant_id`, `doc_version_id`, `chunk_id`, `embedding_model_id`.
- Store lexical fallback representation (`tsvector`) for keyword retrieval fallback.
- Enforce tenant-scoped retrieval paths and filtering support for:
  - `category`.
  - superseded inclusion/exclusion flag.
  - `effective_date` constraints (future retrieval mode).
  - staleness warning flags (future retrieval mode).

## 5) Idempotency and retry rules

- Canonical ingestion idempotency tuple:
  - (`tenant_id`, `doc_version_id`, `parser_version`, `chunker_version`, `embedding_model_id`).
- Vector writes must upsert safely with uniqueness on:
  - (`tenant_id`, `doc_version_id`, `chunk_id`, `embedding_model_id`).
- Retries must not create duplicate chunks or embeddings.
- If partial artifacts exist, rerun must converge to the same terminal state and artifact set.
- Exactly-once delivery is not required; idempotent at-least-once processing is required.

## 6) Error taxonomy (operator-facing + internal)

| Code | Description | Operator remediation | Internal logging fields |
| --- | --- | --- | --- |
| `UNSUPPORTED_MIME` | Uploaded type is outside v1 supported formats. | Re-upload as supported format (`PDF/DOCX/TXT/MD`) or use paste/structured entry. | `tenant_id`, `doc_version_id`, `mime_type`, `stage`, `timestamp` |
| `PARSE_EMPTY_TEXT_SCAN_DETECTED` | Parse produced too little text; likely scanned file needing OCR. | Re-upload digital-text PDF or provide text/structured entry. | `tenant_id`, `doc_version_id`, `stage`, `extracted_char_count`, `page_count_estimate`, `timestamp` |
| `PARSE_FAILED` | Parser failed unexpectedly for supported input. | Retry upload or contact support if repeated. | `tenant_id`, `doc_version_id`, `stage`, `parser_version`, `error_class`, `timestamp` |
| `CHUNK_FAILED` | Chunk generation failed after parse. | Retry ingestion; if persistent, upload revised document. | `tenant_id`, `doc_version_id`, `stage`, `chunker_version`, `error_class`, `timestamp` |
| `EMBED_RATE_LIMIT` | Embedding provider throttled request. | Wait and retry automatically/manual requeue if needed. | `tenant_id`, `doc_version_id`, `stage`, `embedding_model_id`, `retry_count`, `timestamp` |
| `EMBED_FAILED` | Embedding call failed for non-rate-limit reason. | Retry ingestion; escalate if persistent. | `tenant_id`, `doc_version_id`, `stage`, `embedding_model_id`, `error_class`, `timestamp` |
| `INDEX_FAILED` | Vector or lexical index write failed. | Requeue ingestion; contact support if repeated. | `tenant_id`, `doc_version_id`, `stage`, `db_error_code`, `timestamp` |
| `STORAGE_FAILED` | S3 artifact write/read operation failed. | Retry action; check storage availability. | `tenant_id`, `doc_version_id`, `stage`, `storage_op`, `storage_path`, `timestamp` |

## 7) Observability (what to measure)

Docs-only v1 metrics:
- `ingestion_duration_seconds` by stage (`p50`, `p95`).
- `failure_rate` by `error_code`.
- Percent of docs in `needs_attention` due to scan detection.
- `duplicate_upload_rate` via `content_hash` dedupe.
- `queue_latency_seconds` (enqueue to worker start).

## 8) Security & privacy guardrails (v1)

- Require `tenant_id` in every stage record and query path; no cross-tenant reads.
- Store least-privilege artifacts only for retrieval and auditability.
- Avoid logging raw document content; log hashes, sizes, codes, and redacted summaries.
- Treat all uploaded and extracted content as sensitive because files may contain PII.

## 9) Worked example

Example: operator uploads `2026 Terms and Conditions.pdf` as `terms_policy`.

Input metadata snapshot:
- `tenant_id`: `tn_8f2b`
- `doc_id`: `doc_terms_2026`
- `doc_version_id`: `docv_2026_terms_v1`
- `source_type`: `upload`
- `category`: `terms_policy`
- `priority`: `100`
- `effective_date`: `2026-01-01`
- `last_reviewed_at`: `2026-02-01`
- `content_hash`: `sha256:7a6d...c912`

State progression:
1. `received`: raw file stored at `tn_8f2b/doc_terms_2026/docv_2026_terms_v1/original.pdf`.
2. `queued`: BullMQ job created with idempotency tuple (`tn_8f2b`, `docv_2026_terms_v1`, `parser_v1`, `chunker_v1`, `EMBEDDING_MODEL_ID`).
3. `parsing` -> `parsed`: extracted text stored at `tn_8f2b/doc_terms_2026/docv_2026_terms_v1/extracted.txt`.
4. `chunking` -> `chunked`: deterministic chunk rows written.
5. `embedding` -> `indexed`: vectors + lexical entries stored; version is retrieval-ready.

Chunk example row:
- `chunk_id`: `docv_2026_terms_v1_p03_s02`
- `doc_version_id`: `docv_2026_terms_v1`
- `category`: `terms_policy`
- `section_title`: `Cancellation and Refunds`
- `page_range`: `3-3`
- `token_count`: `612`
- `policy_likeness_hint`: `high`
- `language`: `en`

Retry behavior example:
- If embedding fails after chunking, retry reuses the same idempotency tuple and stable `chunk_id` values.
- Existing chunks are reused/upserted, embeddings are upserted by (`tenant_id`, `doc_version_id`, `chunk_id`, `embedding_model_id`), and the run converges to one `indexed` outcome without duplicate artifacts.
