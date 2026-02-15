# DR-0011: Phase 10 — Reliability & Observability (v1): queues, retries, replay, monitoring, kill switches

## Status
Accepted (frozen for Phase 10 v1)

## Date
2026-02-15

## Owners
Product + Eng

## Context
- DR-0010 established baseline reliability intent for Phase 10.
- Steps `10.7.x` and `10.8.x` implemented operator workflows and deterministic local/CI reliability checks.
- We now need a frozen v1 policy that operators and engineering can reference quickly during pilot incidents.

## Decisions (v1 freeze)

### D1) Where queues are mandatory
Decision:
- Pub/Sub push notification ingestion must ACK fast and enqueue work.
- Any outbound draft generation path must be queued (no long synchronous handlers).
- Docs ingestion is queued (`docs_ingestion`) and remains queue-first.
- Work touching externally rate-limited providers (Gmail/OpenAI) must run via queue workers.

Why this matters:
- Prevents request-path timeouts and user-visible fragility.
- Centralizes backpressure, retries, and incident controls.

### D2) Retry vs replay vs ignore
Decision:
- Shared error taxonomy governs behavior:
  - `TRANSIENT` -> retry with configured backoff.
  - `PERMANENT` -> fail fast via `UnrecoverableError`.
  - `IGNORE` -> no-op success path for kill-switch/duplicate/already-done cases.
- Manual replay is command-first via `pnpm -w queue:replay` with dry-run default and explicit confirm.
- Duplicate/already-done processing must be idempotent and operator-visible (deterministic logs/events).

Why this matters:
- Keeps retries safe and bounded.
- Separates engineering fixes from controlled operator recovery.

### D3) Monitoring metrics (v1)
Decision:
- v1 operator monitoring is direct-state based (Redis + Postgres) via `pnpm -w ops:monitor`.
- Required metrics:
  - queue paused state
  - queue counts (`waiting`, `active`, `failed`, `delayed`, optional `completed`)
  - ingestion throughput/failure window (`done`, `failed`, failed rate)
  - stuck processing count
  - global + tenant kill switch state
- `ops:monitor` status contract:
  - `OK` / `WARN` / `ALERT`
  - exit code `0` for `OK`/`WARN`, exit code `2` for `ALERT`, exit code `1` for tool/runtime errors.

Why this matters:
- Gives operators a deterministic incident snapshot and automation-friendly status.

### D4) Kill switches
Decision:
- Global env kill switch and tenant DB kill switch are both required.
- Operator command-first flow is mandatory (`pnpm -w kill-switch:set`) with SQL fallback only when command path is unavailable.
- Enforcement happens before side effects.

Why this matters:
- Fast blast-radius control with predictable operator workflow.

### D5) Pilot runbook operational expectations
Decision:
- One-command local orchestration (`dev:up` / `dev:down`) and deterministic smoke are mandatory.
- Correlation evidence (`notification.received` -> `notification.enqueued` -> `job.start`/`job.done`) is required for incident diagnosis.
- Operator triage flow uses command-first sequence:
  - `ops:triage`
  - `ops:monitor`
  - `ops:alert-drill`
- Production mitigation must avoid ad hoc SQL edits; use guarded commands with dry-run/confirm flags first.

Why this matters:
- Reduces incident variance and operator error under stress.

## Consequences
- Any new phase-10 reliability work must preserve deterministic JSON outputs and explicit confirm flags for mutating operator actions.
- Queue-first semantics are now a policy requirement, not optional implementation preference.
- Future DR amendment required before changing these semantics.

## References
- `docs/decisions/0010-phase-10-reliability-observability.md`
- `docs/phases/phase-10-reliability-observability/phase-10-freeze-v1.md`
- `docs/runbooks/pilot-runbook.md`
