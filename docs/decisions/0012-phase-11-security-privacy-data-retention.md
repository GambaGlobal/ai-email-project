# DR-0012: Phase 11 — Security, Privacy & Data Retention (Trust + Sales)

## Status
Accepted

## Date
2026-02-15

## Owners
Product + Eng

## Context / Problem
- We need a clear, repeatable trust posture for sales/procurement and engineering guardrails.
- We must reduce risk of cross-tenant leakage and token compromise while supporting Gmail-first draft generation.
- Email workflows may contain guest PII, and operator docs are sensitive business content.
- v1 is human-in-control: drafts are never auto-sent.

## Decisions (frozen choices)

### D1) Data minimization defaults
Decision:
- Raw email bodies and attachments are not persisted by default.
- Store only minimal message/thread identifiers and required timestamps/metadata for operations.
- Store operator-provided documents plus derived chunks/embeddings for retrieval.
- Store generated draft artifacts (draft text + citations + status), not full inbox replication.

Why this matters:
- Reduces sensitive-data footprint and breach impact.
- Preserves enough data for traceability and operator review workflows.

### D2) Tenant isolation model
Decision:
- v1 uses a single shared Postgres with strict `tenant_id` scoping for tenant data.
- RLS (or equivalent DB-layer enforcement) is REQUIRED before GA as defense-in-depth.
- S3-compatible storage uses per-tenant prefixes.
- Queue payloads and worker lookups are tenant-scoped.
- Logs/metrics are tenant-aware and PII-minimized.

Why this matters:
- Makes cross-tenant leakage prevention a system invariant across storage, compute, and observability.

### D3) Token & secrets posture
Decision:
- Refresh tokens are stored encrypted at rest using envelope-encryption posture (conceptual model).
- Access tokens are short-lived and not persistently stored by default.
- Tokens/secrets are never logged.
- Disconnect/revoke flows require immediate local disable and token material removal, with audit events.

Why this matters:
- Limits blast radius for credential compromise and enforces consistent secret hygiene.

### D4) Retention & deletion posture (defaults)
Decision:
- Operator docs are retained until operator deletes them; chunks/embeddings follow source lifecycle (+ short grace window).
- Draft records and core metadata default to 180 days.
- System logs default to 30 days; audit events about 1 year; metrics about 13 months.
- Backups age out on a bounded window (35 days).
- Deletion workflows are defined for doc delete, mailbox disconnect, and tenant deletion request; backup copies age out.

Why this matters:
- Balances operational usefulness with privacy minimization and clear deletion expectations.

### D5) AI processing disclosure stance
Decision:
- Send only minimal required email context and relevant document snippets to OpenAI through the internal wrapper boundary.
- Do not send full document libraries per request.
- Human review remains required for v1 outcomes (no auto-send), with sensitive categories flagged.
- Do not claim certifications/compliance achievements not currently attained/documented.

Why this matters:
- Maintains an accurate, non-overpromising trust posture while preserving draft quality.

### D6) Optional debug retention posture
Decision:
- Optional debug retention is conceptually permitted but off by default for v1.
- If implemented later, it must be explicit tenant opt-in, bounded TTL, and strict scope limits.

Why this matters:
- Keeps troubleshooting flexibility without weakening default minimization posture.

## Tradeoffs + Rationale
- Minimization reduces replay/debug depth but materially lowers exposure and trust risk.
- RLS and strict tenant scoping increase engineering complexity but reduce accidental cross-tenant access risk.
- Defined retention windows preserve operational utility while limiting long-lived sensitive data.
- Honest disclosure (no unsupported compliance claims) may slow some deals but avoids trust and legal risk from overstatement.

## Out of Scope / Not Decided
- SOC 2/ISO certification timelines.
- Customer-managed keys (CMK/BYOK) commitments.
- EU/regional data residency rollout timing.
- Dedicated database per tenant model.

Future decisions on these topics require separate DRs.

## References / Evidence
- `docs/phases/phase-11-security/data-map-classification-v1.md`
- `docs/phases/phase-11-security/tenant-isolation-requirements-v1.md`
- `docs/phases/phase-11-security/token-storage-secrets-posture-v1.md`
- `docs/phases/phase-11-security/retention-deletion-policy-v1.md`
- `docs/phases/phase-11-security/security-privacy-faq-v1.md`
- `docs/phases/phase-11-security/questionnaire-pack-lite-v1.md`
