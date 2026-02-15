# Phase 10 Reliability & Observability (v1) Freeze

- Phase: 10
- Date: 2026-02-15
- Status: Active (frozen v1 policy + roadmap)

## A) Decision Record (frozen choices)
- [DR-0011: Phase 10 — Reliability & Observability (v1): queues, retries, replay, monitoring, kill switches](../../decisions/0011-phase-10-reliability-observability-v1-freeze.md)
- Baseline reference: [DR-0010](../../decisions/0010-phase-10-reliability-observability.md)

## B) Evidence Gate (pass/fail)
Phase 10 v1 remains green only if all checks below pass:

1. CI required check: `CI / smoke-gate` is green on PR/main.
2. Local deterministic startup + correlation smoke:
   - `pnpm -w dev:up`
   - `pnpm -w smoke:correlation`
   - Required evidence: `PASS: smoke: PASS ...`
3. Monitoring status contract works:
   - `pnpm -w ops:monitor`
   - Defaults: `WINDOW_MINUTES=15`, `STUCK_THRESHOLD_MINUTES=60`, `WARN_FAILED_RATE=0.10`, `ALERT_FAILED_RATE=0.20`, `WARN_WAITING=50`, `ALERT_WAITING=200`, `WARN_STUCK=1`, `ALERT_STUCK=5`
   - Exit code contract: `0` (`OK/WARN`), `2` (`ALERT`), `1` (tool error)
4. Alert drill must pass end-to-end:
   - `pnpm -w ops:alert-drill` (dry run)
   - `ALERT_DRILL_CONFIRM=1 pnpm -w ops:alert-drill` (must end with `OK ops:alert-drill status=PASS ...`)
5. Kill switch command flow works (dry-run + confirmed apply):
   - `pnpm -w kill-switch:set` (dry run)
   - `KILL_SWITCH_CONFIRM=1 pnpm -w kill-switch:set` (apply)
6. Queue control flow works:
   - `pnpm -w queue:is-paused`
   - `QUEUE_CONTROL_CONFIRM=1 pnpm -w queue:pause`
   - `QUEUE_CONTROL_CONFIRM=1 pnpm -w queue:resume`
7. Stuck docs operator flow works:
   - `pnpm -w docs:unstick` (dry run)
   - `DOCS_UNSTICK_CONFIRM=1 pnpm -w docs:unstick` (apply when needed)

## C) Milestone Map
- **10.8 Ops readiness for docs ingestion chaos (DONE)**
  Why it matters: provides deterministic controls for queue state, failures, triage, monitoring, and drill-based operator confidence.
- **10.9 Inbox notification chaos (Gmail/PubSub) reliability (NEXT)**
  Why it matters: inbound provider events are at-least-once and bursty; this is the highest-risk surface for duplicate/missed work.
- **10.10 Pilot readiness checklist + on-call/incident loop (NEXT)**
  Why it matters: converts tooling into repeatable incident response with clear ownership and response SLAs.

## D) Step Backlog

### DONE (implemented)

#### 10.7.9–10.7.17 status (DONE)
- `10.7.9` DONE — pgvector setup hardened via source-build/install verification.
- `10.7.10` DONE — db setup hardening and extension validation tightened.
- `10.7.11` DONE — tenant DB scoping corrected via `set_config(..., true)` pattern.
- `10.7.12` DONE — deterministic API/worker correlation smoke evidence.
- `10.7.13` DONE — one-command local `dev:up`/`dev:down` orchestration.
- `10.7.14` DONE — CI smoke-gate workflow with Redis/Postgres services.
- `10.7.15` DONE — CI lifecycle and cleanup hardening.
- `10.7.16` DONE — sequence slot consumed by 10.8 operator-hardening continuation (no separate artifact).
- `10.7.17` DONE — sequence slot consumed by 10.8 operator-hardening continuation (no separate artifact).

#### 10.8.1–10.8.15 status (DONE)
- `10.8.1` DONE — shared retry defaults + reliability taxonomy baseline.
- `10.8.2` DONE — transient retry vs permanent fail-fast in worker.
- `10.8.3` DONE — deterministic failed-job replay command.
- `10.8.4` DONE — global + tenant docs ingestion kill switches.
- `10.8.5` DONE — tenant kill switch timestamp correctness + `kill-switch:set` command.
- `10.8.6` DONE — queue status snapshot command.
- `10.8.7` DONE — queue pause/resume/is-paused command.
- `10.8.8` DONE — persisted ingestion failures + list/show commands.
- `10.8.9` DONE — one-shot triage command.
- `10.8.10` DONE — dev-up readiness + log hygiene hardening.
- `10.8.11` DONE — deterministic port/PID ownership in dev-up.
- `10.8.12` DONE — docs ingestion idempotency + de-dupe semantics.
- `10.8.13` DONE — docs unstick operator command.
- `10.8.14` DONE — monitoring metrics + threshold evaluation (`ops:monitor`).
- `10.8.15` DONE — alert drill simulation + recovery verification (`ops:alert-drill`).

### NEXT (10.9.x focus: Gmail/PubSub + email reliability)

#### 10.9.2 — Pub/Sub receipt idempotency key + dedupe store
- Goal: prevent duplicate processing from at-least-once push deliveries.
- Acceptance checks: replay same push payload twice -> one downstream enqueue; deterministic duplicate log event.
- Dependencies: shared correlation helpers, queue contracts, tenant scoping pattern.

#### 10.9.3 — Provider notification receipt/audit table
- Goal: persist every inbound notification with processing state (`received/ignored/processed/failed`).
- Acceptance checks: DB row per receipt with tenant+provider ids; retries update state deterministically.
- Dependencies: 10.9.2, DB migration policy.

#### 10.9.4 — Notification replay/ignore operator flow
- Goal: command-first reprocessing for bounded receipt ranges.
- Acceptance checks: dry-run default, confirm gating, deterministic JSON outputs, scoped replay only.
- Dependencies: 10.9.3, existing operator command conventions.

#### 10.9.5 — Gmail history cursor dedupe + gap detection
- Goal: process Gmail history IDs idempotently and detect missed ranges for resync.
- Acceptance checks: duplicate history id ignored; gap emits deterministic incident signal.
- Dependencies: 10.9.2, provider-specific Gmail adapter boundaries.

#### 10.9.6 — Gmail/OpenAI rate-limit backoff policy hardening
- Goal: normalize provider 429/5xx handling and bounded backoff across API/worker paths.
- Acceptance checks: synthetic 429 classification -> transient retry policy observed; no hot-loop retries.
- Dependencies: shared error taxonomy, worker retry semantics.

#### 10.9.7 — Permanent failure quarantine policy (DLQ/quarantine design + implementation plan)
- Goal: freeze v1 policy for permanent failures in inbound mail pipeline and define controlled recovery.
- Acceptance checks: design artifact references operator commands, replay scope rules, and audit requirements.
- Dependencies: 10.9.3, 10.9.4.

#### 10.9.8 — Docs storage mode reliability checks (local vs S3-compatible)
- Goal: verify integrity/consistency behavior when toggling docs storage modes in pilot.
- Acceptance checks: upload/read/retry path parity checks for both modes; deterministic error surfacing.
- Dependencies: current docs ingestion flow, env toggles.

#### 10.9.9 — ALERT routing contract (design-only)
- Goal: define how `ops:monitor` ALERT (`exit=2`) integrates with Slack/email routing later.
- Acceptance checks: design doc + runbook flow with trigger ownership and ack/escalation policy.
- Dependencies: `ops:monitor`/`ops:alert-drill` status contract.

## E) Notes
- This document freezes Phase 10 v1 reliability scope and separates delivered operator readiness from remaining Gmail/PubSub reliability work.
- Any semantic change to retries/replay/monitoring/kill-switch behavior requires a DR amendment.
