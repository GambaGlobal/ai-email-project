# Phase 13 Closeout: Document System + Retrieval + Citation Contract

## Date
2026-02-17

## A) Decision Records (Phase 13)
- [`../../decisions/0014-phase-13-doc-model-versioning-states.md`](../../decisions/0014-phase-13-doc-model-versioning-states.md)
- [`../../decisions/0015-phase-13-s3-system-of-record-presigned-uploads.md`](../../decisions/0015-phase-13-s3-system-of-record-presigned-uploads.md)
- [`../../decisions/0016-phase-13-doc-ingestion-extraction-v1.md`](../../decisions/0016-phase-13-doc-ingestion-extraction-v1.md)
- [`../../decisions/0017-phase-13-doc-indexing-chunking-embeddings.md`](../../decisions/0017-phase-13-doc-indexing-chunking-embeddings.md)
- [`../../decisions/0018-phase-13-retrieval-canonical-first.md`](../../decisions/0018-phase-13-retrieval-canonical-first.md)
- [`../../decisions/0019-phase-13-citation-contract-audit-v1.md`](../../decisions/0019-phase-13-citation-contract-audit-v1.md)

## B) Success Metrics + Evidence Gate
Big outcome: tenant-safe docs become retrieval-ready evidence, and generation preview is contract-enforced with auditable citations.

### Gate 1: S3 + version model + extraction + indexing path is complete
1. Upload/finalize a doc version through API doc upload/finalize endpoints.
2. Enqueue ingestion + indexing:
```bash
pnpm -w doc:ingest:enqueue --tenant-id <tenantId> --doc-id <docId> --version-id <versionId>
pnpm -w doc:index:enqueue --tenant-id <tenantId> --doc-id <docId> --version-id <versionId>
```
Pass means:
- `doc_versions.state='ACTIVE'` for target version
- `doc_chunks` rows exist for `(tenant_id, version_id)`.

### Gate 2: Retrieval returns versioned citation payload
```bash
curl -X POST http://localhost:3001/v1/retrieval/query \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: <tenantId>" \
  -d '{"query":"What is your refund policy?","topK":5}'
```
Pass means:
- response includes `version: "v1"`
- response includes `reason` and `sources[]`
- sources carry provenance fields for `doc_chunk` or `canonical_qa`.

### Gate 3: Generation preview enforces citation payload and writes audit
```bash
curl -X POST http://localhost:3001/v1/generate/preview \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: <tenantId>" \
  -H "x-correlation-id: phase13-closeout-check-001" \
  -d '{"query":"What is your cancellation policy?","topK":5}'
```
Pass means:
- response returns `draft_text`, `citation_payload`, `audit_id`
- `citation_payload.version === "v1"`
- one row exists in `generation_audits` for returned `audit_id` and tenant.

Optional DB verification:
```bash
psql "$DATABASE_URL" -c "select id, tenant_id, citation_contract_version, created_at from generation_audits order by created_at desc limit 5;"
```

## C) Milestone Map (Complete)
1. Immutable doc version model + state machine
- Why it matters: creates deterministic ingestion/indexing lifecycle and retrieval-readiness boundary.
2. S3 system-of-record for raw and extracted artifacts
- Why it matters: keeps source docs in tenant-controlled storage flow and avoids provider lock-in.
3. Deterministic extraction and pgvector indexing
- Why it matters: makes retrieval quality reproducible and idempotent across retries.
4. Canonical-first retrieval with tenant-safe provenance
- Why it matters: prioritizes operator-approved answers before fallback semantic retrieval.
5. Versioned citation payload contract + preview enforcement
- Why it matters: creates explainable, auditable evidence trail from retrieval to generated text.

## D) Step Backlog Summary (13.1-13.6)
| Step | Status | Summary | Commits |
| --- | --- | --- | --- |
| 13.1 | Complete | S3 presigned upload/download + raw key persistence on `doc_versions`. | `4190a44` |
| 13.2 | Complete | `docs` + `doc_versions` model and tenant-safe API helpers. | `bcd063b` |
| 13.3 | Complete | Extraction worker writes deterministic artifacts to S3; `extracted_text_key` persisted; hardening and ledger reconciliation applied. | `8b3cbcd` (feature), `72662e5` (hardening), `29b2732` (ledger reconcile, docs-only) |
| 13.4 | Complete | Chunking + embeddings + pgvector indexing + ACTIVE promotion. | `9cf6bc1` |
| 13.5 | Complete | Canonical-first retrieval endpoint + shared retrieval schema; excerpt-only hardening follow-up applied. | `54fd3fc` (feature), `7d4efde` (excerpt-only hardening) |
| 13.6 | Complete | Citation payload contract `v1`, generation preview endpoint, audit persistence; hardening + ledger reconcile applied. | `bb338eb` (feature), `da86c46` (hardening), `0724b33` (ledger reconcile, docs-only) |

## E) Known Gaps / Follow-Ups
- Knowledge Tester UI milestone (Next.js admin page) for operator-visible retrieval + citation inspection.
- Canonical QA admin CRUD endpoints and workflow controls (DRAFT -> APPROVED -> ARCHIVED).
- Retrieval evaluation harness (Recall@K, citation coverage, unsupported-claim rate).
- Performance tuning and operational index maintenance (`ANALYZE`/vacuum cadence and query profiling) as corpus grows.

## F) Phase 14 Planning Prompt (Recommendation)
Recommended next phase goal: operator-facing trust loop on top of Phase 13 foundations.

Candidate early steps:
1. Build Knowledge Tester API contract + minimal admin page shell.
2. Implement Canonical QA admin endpoints with tenant-safe moderation flow.
3. Add retrieval/citation quality eval harness with baseline scorecard.

Which Step ID should we run first?
