# Phase 2 Closeout

## A) Phase Goal (1–2 sentences)
Lock system boundaries so we do not rewrite later when adding Outlook or scaling the pipeline. Phase 2 codifies contracts, data model, and enforcement so Phase 3 can implement features with minimal drift.

## B) What we shipped (bulleted, short)
- Architecture overview with boundaries, pipeline, and failure modes (`docs/architecture/overview.md`).
- Canonical contracts for MailProvider, pipeline, AI boundary, and auditability (`docs/architecture/contracts.md`).
- Minimal data model spec and ERD (`docs/architecture/data-model.md`).
- Postgres migrations for minimal multi-tenant schema (`packages/db/migrations/002_minimal_schema.js`).
- RLS tenant isolation policies + verification script (`packages/db/migrations/003_tenant_rls.js`, `packages/db/verify/rls-smoke.sql`).
- Shared MailProvider models + interfaces (`packages/shared/src/mail/*`).
- GmailProvider stub adapter (`packages/mail-gmail/`).
- Runtime provider registry composition root (`packages/mail-providers/`).
- Shared pipeline contract types (`packages/shared/src/pipeline/types.ts`).
- Shared queue contracts + envelope helper (`packages/shared/src/queue/types.ts`).

## C) Decision Record (frozen choices)
Frozen choices (summary):
- Stack lock per DR-0001: TypeScript monorepo, Next.js admin, Fastify API, Node worker, Postgres + pgvector, BullMQ + Redis, S3, Gmail + Pub/Sub, OpenAI Responses wrapper.
- Architecture lock per DR-0007: event-driven pipeline, MailProvider boundary, idempotency, guardrails-first, auditability, multi-tenant enforcement.
- API framework per DR-0002: Fastify.

References:
- `docs/decisions/0001-tech-stack.md`
- `docs/decisions/0007-phase-2-architecture-lock.md`
- `docs/decisions/0002-api-framework.md`

Amendment rule: any change to these frozen choices requires a new Decision Record amendment in `docs/decisions/`.

## D) Success metrics + evidence gate
Evidence gate checklist (must be true to proceed):
- Architecture docs exist and agree (overview, contracts, data model).
- DB schema exists with tenant isolation + idempotency constraints.
- Shared contracts compile (mail + pipeline + queue).
- Gmail provider adapter stub exists (no SDK usage).
- Runtime provider registry resolves gmail and blocks outlook.
- `pnpm -w repo:check` passes on main.

Suggested Phase 2 success metrics (conceptual):
- 0 cross-tenant access in RLS smoke test.
- 0 drift between API/worker job payloads (shared types enforced).
- 0 provider SDK imports outside provider packages.

## E) Milestone Map (for NEXT phase, 3–7 milestones)
- Gmail OAuth connect + mailbox record created — unblocks real mailbox setup and provider health.
- Pub/Sub watch subscription + webhook verification — enables reliable inbound notifications.
- Inbound notification → job enqueued (idempotent) — proves event pipeline wiring end-to-end.
- Worker fetches message/thread via GmailProvider (real calls) — validates provider adapter boundary.
- Guardrails classifier + sensitive routing — enforces trust and human-in-control.
- Retrieval + evidence-gated drafting — ensures responses are grounded in operator docs.
- Draft created in Gmail thread + audit trail complete — completes the v1 draft loop.

## F) Step Backlog (for NEXT phase)
**3.1 — Gmail OAuth connect + mailbox create**
- Goal: Implement OAuth flow to connect Gmail and persist mailbox state.
- Acceptance checks: mailbox row created with provider ids; token refresh path works; no auto-send.
- Dependencies: DR-0001, MailProvider contracts, DB schema.

**3.2 — Pub/Sub watch subscription + webhook verification**
- Goal: Start Gmail watch and verify webhook signatures.
- Acceptance checks: watch state stored; invalid signatures rejected.
- Dependencies: 3.1, MailProvider stub -> real GmailProvider.

**3.3 — Notification ingest to canonical event**
- Goal: Translate Gmail notifications to canonical events and persist idempotently.
- Acceptance checks: duplicates deduped; events stored with correlation ids.
- Dependencies: 3.2, pipeline types.

**3.4 — Enqueue inbound job (BullMQ)**
- Goal: Enqueue `mail.processInboundMessage` with shared envelope helper.
- Acceptance checks: job payload matches shared types; retries configured via defaults.
- Dependencies: 3.3, queue contracts.

**3.5 — Worker fetch message + thread (GmailProvider)**
- Goal: Worker fetches normalized message and thread data from Gmail.
- Acceptance checks: canonical message/thread shapes populated; errors classified.
- Dependencies: 3.4, GmailProvider real calls.

**3.6 — Guardrails + sensitive routing**
- Goal: Implement classifier to flag sensitive messages before drafting.
- Acceptance checks: sensitive paths create review-required outcome; no draft created by default.
- Dependencies: 3.5, AI boundary contracts.

**3.7 — Retrieval + evidence gating**
- Goal: Retrieve top evidence chunks and enforce evidence gating.
- Acceptance checks: missing evidence triggers clarifying draft; evidence ids logged.
- Dependencies: 3.6, embeddings stored.

**3.8 — Draft generation + Gmail draft create**
- Goal: Create draft in Gmail thread with audit trail.
- Acceptance checks: one draft per inbound message; audit_event records complete.
- Dependencies: 3.7, GmailProvider draft method.

**3.9 — Observability + audit trail completeness**
- Goal: Ensure audit_event coverage per run and correlation ids across stages.
- Acceptance checks: required audit stages recorded; run links to evidence.
- Dependencies: 3.8, audit contracts.

**3.10 — RLS usage in app role**
- Goal: Ensure DB access uses non-owner role so RLS is enforced.
- Acceptance checks: owner bypass avoided; smoke test passes under app role.
- Dependencies: 3.1, DB RLS policies.

**3.11 — Admin onboarding MVP**
- Goal: Provide minimal admin UI to connect Gmail and upload docs.
- Acceptance checks: connect flow works; docs uploaded and chunked.
- Dependencies: 3.1, 3.7.

## G) Risks + mitigations (short)
1. Provider rate limits or watch gaps — build resync pathway and backoff strategy early.
2. Cross-tenant data leaks — enforce RLS with non-owner role and automated smoke tests.
3. Draft quality issues — gate on evidence, log claims + evidence, and require human review on low confidence.
4. Notification duplication or loss — idempotent event keys and resync for gaps.
5. Scope creep into auto-send — keep drafts-only invariant enforced in code and reviews.

## H) “Which Step ID should we run first?”
Which Step ID should we run first?
