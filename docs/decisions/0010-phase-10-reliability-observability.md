# DR-0010: Phase 10 — Reliability & Observability Baseline

## Status
Proposed (Phase 10 baseline)

## Date
2026-02-12

## Owners
Product + Eng

## Context
- Gmail push delivery is at-least-once; duplicate and bursty notifications are expected behavior.
- Gmail and OpenAI integrations are rate-limited and occasionally fail due to transient and provider-side conditions.
- We need a reliability baseline that prevents lost emails, prevents duplicate drafts, enables safe recovery, and preserves operator trust.
- This Decision Record sets baseline operational constraints for Phase 10 implementation and pilot operations.

## Decisions

### D1) Queue-first execution model
Decision:
- API endpoints enqueue work only.
- Worker processes execute all side effects (Gmail fetch, OpenAI generation, Gmail draft writeback).

Rationale:
- Isolates user-facing latency from provider volatility.
- Centralizes retries, backpressure handling, and concurrency controls.

Consequences:
- Reliable queue operations are now critical-path infrastructure.
- Operators may observe short processing delays during bursts; this is acceptable if bounded and visible.

### D2) Idempotency everywhere
Decision:
- Every stage uses deterministic idempotency keys.
- Deduplication state is stored in Postgres and enforced before side effects.
- External effects target exactly-once outcomes even with at-least-once event delivery.

Rationale:
- Duplicate deliveries are normal and must be safe by design.
- Trust is damaged quickly by duplicate drafts or repeated side effects.

Consequences:
- Additional schema and bookkeeping complexity per stage.
- Replay and retries become safer and more predictable.

### D3) Retry policy by error class
Decision:
- Transient failures retry with bounded exponential backoff + jitter.
- Permanent/auth/config failures are routed to action-needed handling and DLQ.
- Benign duplicates are ignored after dedupe checks, but are still measured.

Rationale:
- Uniform retries for all errors can amplify incidents and hide root causes.
- Explicit error-class routing improves recovery speed and operational clarity.

Consequences:
- Error classification taxonomy must be maintained and tested.
- Dashboards/alerts must segment transient vs permanent failure classes.

### D4) DLQ + audited replay
Decision:
- Dead-letter queue is mandatory for non-recoverable jobs.
- Replay must be scoped and audited (who, what scope, when, why).
- Support both DLQ replay and history-range replay for controlled recovery.

Rationale:
- Reliable recovery requires explicit replay pathways, not manual ad hoc fixes.
- Auditability is required for trust and tenant safety.

Consequences:
- Replay tooling and audit storage are required pilot deliverables.
- Strict replay permissions are required to limit accidental broad reprocessing.

### D5) Observability baseline
Decision:
- Use structured logs with correlation IDs across API, queue, and worker stages.
- Baseline metrics cover pipeline latency, queue health, provider errors, and data integrity.
- Distributed tracing is optional and may be added later if metrics/logs prove insufficient.

Rationale:
- Pilot reliability depends on fast, concrete diagnosis, not guesswork.
- Metrics and structured logs provide the minimum viable evidence for incident response.

Consequences:
- Common correlation and event naming conventions must be enforced in runtime code.
- Additional instrumentation effort is required before pilot launch.

### D6) Kill switches
Decision:
- Provide global and per-tenant kill switches.
- Enforce kill switches before side effects.
- Include safe-degrade modes: disable writeback, disable OpenAI, force human review.

Rationale:
- Fast, controlled mitigation limits blast radius during provider or logic incidents.
- Trust requires safe fallback behavior instead of silent partial failures.

Consequences:
- Runtime path must evaluate switch state in every side-effecting stage.
- Admin surface must expose minimal controls with audit logging.

## Alternatives considered
- Synchronous processing in API: rejected due to poor resilience under provider latency/failures and weak backpressure control.
- "Just retry" without DLQ/replay: rejected because stuck/permanent failures become opaque and hard to recover safely.
- No idempotency: rejected because duplicate event delivery would create duplicate drafts and operator trust regressions.

## Pilot defaults / Open questions
- Pilot p95 time-to-draft target default: <= 2 minutes.
- Raw event retention for replay default: 14 days.
- Observability vendor stance: vendor-neutral baseline; do not hardcode vendor lock-in in core contracts.
- Replay permissioning default: founders-only during pilot.
- Kill switch UX surface default: minimal admin controls with audited state changes.

## References
- `docs/runbooks/pilot-runbook.md`
- `docs/decisions/0004-phase-6-gmail-draft-lifecycle.md`
- `docs/decisions/0005-phase-7-knowledge-ingestion-retrieval.md`
- `docs/decisions/0006-phase-8-guardrails-human-review-trust.md`
- `docs/decisions/0009-phase-9-operator-setup-min-admin-ux.md`
