# Phase 6 — Gmail Integration & Draft Lifecycle

## Phase goal
Freeze implementation-ready contracts so Phase 7 can ship reliable Gmail thread drafting with deterministic safety, dedupe, and observability.

## What’s in scope (Phase 6)
- MailProvider thread/draft + cursor contract (`packages/shared/src/mail/provider.ts`, B).
- Gmail-visible exclusive state labels (`packages/shared/src/mail/labels.ts`, B.1).
- Eligibility and sensitive triage rules (`packages/shared/src/mail/rules.ts`, B.2).
- Cursor ingestion + canonical system label normalization (`packages/shared/src/mail/ingestion.ts`, B.3).
- Draft ownership/fingerprint safety helpers (`packages/shared/src/mail/drafts.ts`, B.4).
- Concurrency/ordering/idempotency helpers (`packages/shared/src/mail/concurrency.ts`, B.5).
- Lifecycle planner outcomes (`packages/shared/src/mail/lifecycle.ts`, B.6).
- Failure/retry/resync mapping (`packages/shared/src/mail/failures.ts`, B.7).
- Telemetry schema + envelope (`packages/shared/src/telemetry/*`, B.8).

## What’s out of scope (Phase 6)
- Runtime Gmail API integration and Pub/Sub handler wiring.
- BullMQ runtime execution and lock orchestration.
- DB migrations/persistence changes.
- Auto-send or outbound send workflows.

## Evidence gate (Phase success definition)
- [ ] Draft reliability: >= 99% of eligible threads produce Ready-labeled draft in staging.
  Measurement: `mail.triage.decided` + `mail.draft.upsert_result` + `mail.label.applied`.
- [ ] Latency p95 <= 2 minutes from ingestion to draft upsert result in staging.
  Measurement: `mail.ingestion.plan_built` -> `mail.draft.upsert_result` by correlationId.
- [ ] Latency p50 <= 20 seconds from ingestion to draft upsert result in staging.
  Measurement: same correlationId-based event timing.
- [ ] Safety overwrite protection: exactly 0 successful overwrites of human-edited drafts.
  Measurement: `mail.blocked_user_edited` and absence of contradictory update outcomes.
- [ ] Dedupe/idempotency: duplicate notifications produce no duplicate draft slot writes.
  Measurement: draft slot idempotency key collisions resolved without extra drafts.
- [ ] Correct routing: sensitive/refund/medical/safety/legal samples route to Needs review at expected rates.
  Measurement: `mail.triage.decided` action/reason against seeded dataset.
- [ ] Failure handling: provider outage/rate-limit paths produce Error + backoff behavior, no infinite retry loops.
  Measurement: `mail.failure.classified` + retry class audit in staging runbook.
- [ ] Resync handling: `needsFullSync`/invalid cursor triggers bounded backfill (7 days) without loss in harness tests.
  Measurement: `mail.resync.decided` + reconciliation assertions.
- [ ] Telemetry completeness: required Phase 6 event names emitted with required context fields.
  Measurement: schema validation on captured envelopes.
- [ ] Privacy compliance: telemetry includes no body/subject/snippet/guest-address fields.
  Measurement: payload contract checks in QA harness.

## Milestone map (Phase 7 build)
1. Gmail OAuth + mailbox connect.
Why it matters: unlocks real tenant mailbox access.
2. Watch/subscription management service (Pub/Sub).
Why it matters: enables near-real-time change detection.
3. Cursor storage + listChanges ingestion worker.
Why it matters: makes incremental sync reliable and restart-safe.
4. Thread fetch + triage worker.
Why it matters: enforces eligibility/safety before any draft action.
5. Draft upsert + label application.
Why it matters: produces visible Gmail outcomes operators can trust.
6. Idempotency + single-flight enforcement.
Why it matters: prevents duplicate drafts and race-condition overwrites.
7. Observability + QA harness.
Why it matters: proves evidence gate before broad rollout.

## Step backlog (Phase 7 execution)
### 7.1 Define mailbox OAuth storage model + interfaces (types/docs only)
- Goal: specify mailbox auth/token lifecycle interfaces and data ownership boundaries.
- Acceptance checks: contracts documented, shared types compile, no runtime code.
- Dependencies: DR-0001, DR-0004.

### 7.2 Implement Gmail OAuth connect in admin app (minimal, testable)
- Goal: complete user connect flow and persist mailbox linkage.
- Acceptance checks: connect succeeds in staging, mailbox link visible, repo checks pass.
- Dependencies: 7.1.

### 7.3 Implement token refresh + auth guardrails (API)
- Goal: ensure provider calls can refresh and fail safely on revoked auth.
- Acceptance checks: refresh path tested, revoked auth classified correctly, repo checks pass.
- Dependencies: 7.1, 7.2.

### 7.4 Implement watch manager (create/renew/stop) with Pub/Sub
- Goal: manage Gmail watch lifecycle outside MailProvider boundary.
- Acceptance checks: watch create/renew/stop paths work in staging; renewal schedule documented.
- Dependencies: 7.3.

### 7.5 Implement Pub/Sub push endpoint -> enqueue ingestion job (no processing yet)
- Goal: accept validated notifications and enqueue ingestion intent.
- Acceptance checks: valid events enqueue once; invalid signatures rejected; repo checks pass.
- Dependencies: 7.4.

### 7.6 Implement cursor store + ingestion worker listChanges flow
- Goal: persist mailbox cursor and derive work plans from provider changes.
- Acceptance checks: cursor monotonic updates; `needsFullSync` path triggers resync plan.
- Dependencies: 7.5.

### 7.7 Implement work-item dedupe store (idempotency uniqueness)
- Goal: enforce one processing unit per idempotency key.
- Acceptance checks: duplicate notifications do not duplicate work execution.
- Dependencies: 7.6.

### 7.8 Implement thread fetch worker (includeBody=false first)
- Goal: fetch canonical thread/message context for planning.
- Acceptance checks: thread fetch events emitted; message counts match provider data.
- Dependencies: 7.6.

### 7.9 Implement triage + lifecycle plan execution skeleton (no AI generation yet)
- Goal: execute lifecycle planner outcomes for ignore/needs_review/draft intent.
- Acceptance checks: deterministic planner outputs consumed and logged; no draft body generation yet.
- Dependencies: 7.8.

### 7.10 Implement Gmail label ensure/apply (Ready/Needs review/Error)
- Goal: enforce exclusive state labels on thread outcomes.
- Acceptance checks: only one state label present at a time in staging threads.
- Dependencies: 7.9.

### 7.11 Implement draft upsert with marker + fingerprint guardrails
- Goal: create/update drafts using `upsertThreadDraft` protections.
- Acceptance checks: created/updated/unchanged outcomes observed; fingerprint checks enforced.
- Dependencies: 7.9, 7.10.

### 7.12 Implement blocked_user_edited handling -> Needs review label
- Goal: route guardrail blocks to human review reliably.
- Acceptance checks: blocked updates never mutate user-edited drafts; Needs review label applied.
- Dependencies: 7.11.

### 7.13 Add staging test harness with seeded threads + expected outcomes
- Goal: automate end-to-end scenario verification for eligibility, labels, and draft lifecycle.
- Acceptance checks: harness passes for seeded sensitive/normal/conflict cases.
- Dependencies: 7.10, 7.12.

### 7.14 Emit telemetry events end-to-end + evidence gate runbook
- Goal: emit all required Phase 6 telemetry events and validate evidence gate.
- Acceptance checks: event schema validation passes; evidence gate checklist report produced.
- Dependencies: 7.13.

## Which step to run first
Next recommended Step: 7.1
