# DR-0014: Phase 13 Doc Model - Versioning and States

## Status
Accepted

## Date
2026-02-15

## Context
- Phase 13 needs a canonical document model that supports repeat uploads, safe activation, and auditability.
- Existing `docs` rows are used by current flows, but do not yet model immutable per-version state transitions.
- We need strict tenant scoping and invariants that prevent stale versions from appearing as current.

## Decision
1. Keep `docs` as the logical document identity table and add metadata fields (`doc_type`, `created_by`).
2. Introduce `doc_versions` for immutable version records with state machine values:
   - `UPLOADED`, `PROCESSING`, `ACTIVE`, `ARCHIVED`, `ERROR`
3. Enforce invariants at the database level:
   - unique version number per doc: `UNIQUE (doc_id, version_number)`
   - only one active version per doc: partial unique index on `doc_id WHERE state = 'ACTIVE'`
4. Enforce tenant-safe joins using composite FK:
   - `doc_versions(tenant_id, doc_id) -> docs(tenant_id, id)`
5. Add tenant-oriented indexes for lookup paths used by API/worker flows.

## Alternatives Considered
- Store all version fields on `docs` only.
  - Rejected: allows state overwrite and weakens lineage/auditability.
- Enforce active-version uniqueness only in application code.
  - Rejected: race-prone under concurrent updates.

## Consequences
- Slightly higher write/query complexity due to two-table model.
- Stronger correctness guarantees for version activation and future ingestion/indexing steps.

## References
- `docs/decisions/0001-tech-stack.md`
- `packages/db/migrations/016_doc_versions_model.js`
