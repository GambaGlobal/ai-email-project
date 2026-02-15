# Phase 10 Closeout (v1): Reliability & Observability

- Phase: 10
- Date: 2026-02-15
- Status: Closed (v1)

## A) Outcome statement
Phase 10 established a reliability-first operating baseline so the system can survive inbox chaos (duplicates, retries, bursts, partial outages) without silent loss of work. Operators now have deterministic command-first controls for triage, mitigation, replay, and recovery.

The platform now enforces explicit idempotency boundaries and durable ledgers across docs ingestion and Gmail notification surfaces, with predictable retry/replay/ignore behavior and a CI smoke-gate that validates these reliability contracts continuously.

## B) What Is DONE

### Docs ingestion reliability
- Deterministic idempotency and de-dupe on ingestion paths.
- Global + tenant kill switches and command-first control (`pnpm -w kill-switch:set`).
- Replay and recovery tooling (`pnpm -w queue:replay`, `pnpm -w docs:unstick`).
- Operator visibility and incident commands (`pnpm -w ops:triage`, `pnpm -w ops:monitor`, queue status/control commands).
- Alert drill and deterministic local bring-up (`pnpm -w ops:alert-drill`, `pnpm -w dev:up`, `pnpm -w dev:down`).

### Gmail notification boundary reliability
- Durable notification receipt ledger with dedupe at boundary.
- Enqueue-once fanout gate semantics with deterministic dedupe behavior.
- Poison protection with durable processing status and permanent vs transient handling.

### Mailbox sync reliability
- Mailbox-level coalescing and cursor invariants.
- HistoryId precision hardening (no JS number coercion).
- Durable mailbox sync run ledger and replay commands.
- Kill-switch enforcement for mail pipeline enqueue/processing.

### CI smoke-gate coverage
`CI / smoke-gate` validates:
- `pnpm -w smoke:correlation`
- `pnpm -w smoke:notify-dedupe`
- `pnpm -w smoke:notify-fanout`
- `pnpm -w smoke:notify-coalesce`
- `pnpm -w smoke:notify-historyid`
- `pnpm -w smoke:notify-poison`
- `pnpm -w smoke:mailbox-sync-run`

## C) Decision Record contract (high level)
Source of truth: [DR-0011](../../decisions/0011-phase-10-reliability-observability-v1-freeze.md)

Phase 10 contract at a glance:
- Exit codes: monitoring contract remains automation-friendly (`ops:monitor`: `0` OK/WARN, `2` ALERT, `1` error).
- Kill-switch semantics: command-first, tenant-safe controls; disabled paths use deterministic ignore behavior and preserve replayability.
- Retry/replay/ignore semantics: transient failures retry, permanent failures fail fast, and replay uses explicit operator-confirmed workflows.

## D) Evidence gate (deterministic proof)

### Local mirror of CI
```bash
pnpm -w repo:check
pnpm -w dev:up
pnpm -w smoke:correlation
pnpm -w smoke:notify-dedupe
pnpm -w smoke:notify-fanout
pnpm -w smoke:notify-coalesce
pnpm -w smoke:notify-historyid
pnpm -w smoke:notify-poison
pnpm -w smoke:mailbox-sync-run
pnpm -w dev:down
```

### CI proof
See `docs/runbooks/branch-protection.md` (`CI proof (deterministic)`) for exact UI steps.
- Required check name: `CI / smoke-gate`
- Failure artifact path: `Actions run -> Artifacts -> ci-smoke-logs`

## E) Pilot runbook expectations (operator-first)
Source of truth: `docs/runbooks/pilot-runbook.md`

First 5 commands during incident triage:
1. `pnpm -w ops:triage`
2. `pnpm -w ops:monitor`
3. `pnpm -w queue:status`
4. `pnpm -w queue:pause`
5. `pnpm -w queue:resume`

Follow-on recovery commands:
- `pnpm -w kill-switch:set`
- `pnpm -w docs:unstick`
- `pnpm -w queue:replay`
- `pnpm -w mail:receipts:replay`
- `pnpm -w mailbox:sync:replay`

## F) Phase 11 entry criteria
- Mailbox sync job fetches provider history and resolves changed message IDs (stub replacement).
- Draft generation pipeline has explicit idempotency boundaries from trigger to draft write.
- Human-review and safety policy outcomes are enforced in draft creation flow.
- End-to-end telemetry covers trigger -> processing -> draft outcome with stable correlation IDs.
- Operational dashboards/alerts map to draft pipeline SLO signals, not only plumbing health.
- Replay and recovery paths are defined for draft-stage failures with tenant-safe guardrails.
- CI smoke coverage includes a draft-pipeline reliability proof in addition to infrastructure smokes.
