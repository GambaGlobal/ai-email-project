# Pilot Runbook: Reliability & Observability (Phase 10)

## Preflight (required)
Run this preflight before using the rest of this runbook, especially on a fresh machine or freshly cloned repo.

Version checks:
- Node.js: use the repo's `.nvmrc` if present; otherwise use a current LTS release.
- pnpm: `10.29.2` (pinned in `package.json` `packageManager`).

Fresh setup:
1. `pnpm -v`
2. `node -v`
3. `pnpm -w install`
4. `pnpm -w preflight`
5. `pnpm -w repo:check`

If you see `Local package.json exists, but node_modules missing`, dependencies are not installed for that workspace yet. Run `pnpm -w install` and then rerun `pnpm -w preflight`.

## Purpose & scope
This runbook defines pilot operations readiness, incident triage, mitigation, recovery, and evidence capture for the Gmail-first draft pipeline. It is designed for safe operations where no customer email is auto-sent in v1.

## Definitions
- tenant: operator account boundary and isolation unit.
- mailbox: connected inbox identity under a tenant.
- thread: provider conversation containing one or more messages.
- job: queued work unit for processing a stage.
- stage: pipeline step (ingest, fetch, classify, generate, writeback).
- DLQ: dead-letter queue for jobs that cannot complete through normal retry policy.
- replay: controlled reprocessing of failed or historical events.
- idempotency: deterministic prevention of duplicate side effects for repeated inputs.
- checkpoint lag: delay between latest provider event and system checkpoint/cursor progress.

## What good looks like (daily checklist)
- Queue depth and oldest job age are within baseline thresholds.
- p50 and p95 time-to-draft are stable and within pilot targets.
- Draft success rate is stable; review routing rate is explainable.
- Gmail auth and watch health are green for active tenants.
- DLQ rate is low and bounded; all DLQ entries have clear reason codes.
- Checkpoint lag is near real-time for active mailboxes.
- No unexplained duplicate draft reports.

## Key metrics to watch (baseline)

### Pipeline
- Time-to-draft p50 and p95
- Draft success rate
- Human-review routing rate

### Queue
- Queue depth
- Oldest job age
- Throughput
- Retry rate
- DLQ rate

### Provider
- Gmail 401/403/429/5xx rates
- Pub/Sub notification volume and duplicate rate
- OpenAI error rate and latency

### Integrity
- Dedupe hit rate
- Checkpoint lag

## Log fields (correlation)
Use the same structured keys in API + worker logs:
- tenantId
- mailboxId
- provider
- stage
- queueName
- jobId
- correlationId
- causationId
- threadId
- messageId
- gmailHistoryId
- event
- elapsedMs
- error

`correlationId` ties API receipt and enqueue events to worker processing events through writeback-adjacent stages. `threadId` and `messageId` may be missing at receipt/ingest time and should appear once fetch/classify stages have provider identifiers.

## Local smoke test (correlation/logs)
1. Start API and worker in separate terminals.
2. Trigger a single ingestion enqueue through the local docs ingestion route.
3. Confirm API logs include `notification.received` and `notification.enqueued` with the same `correlationId`.
4. Confirm worker logs include `job.start` and `job.done` with that same `correlationId`.
5. If `correlationId` does not match across API and worker for the same job, stop and fix enqueue context propagation before pilot use.

## Correlation E2E smoke
Use this deterministic local sequence to prove the same `correlationId` flows API -> queue -> worker for docs ingestion:
1. Start local infra if needed for queueing/storage: `pnpm dev:infra`
2. Start API: `pnpm -w --filter @ai-email/api dev`
3. Start worker: `pnpm -w --filter @ai-email/worker dev`
4. Run smoke request: `pnpm -w smoke:correlation`
5. Copy the `correlationId` from `SMOKE_REQUEST_SENT`.
6. Confirm API logs contain `notification.received` and `notification.enqueued` with that same `correlationId`.
7. Confirm worker logs contain `job.start` and `job.done` (or `job.error`) with that same `correlationId`.

Core keys expected on these events:
- event
- correlationId
- jobId (where applicable)
- tenantId (if present)
- startedAt / elapsedMs (worker events)

Grep examples:
- API logs: `grep "<correlationId>" <api-log-file> | grep -E "notification.received|notification.enqueued"`
- Worker logs: `grep "<correlationId>" <worker-log-file> | grep -E "job.start|job.done|job.error"`

## Typecheck commands
Use these commands for local reliability checks:
- Canonical gate: `pnpm -w repo:check`
- Direct turbo equivalent: `pnpm -w turbo run typecheck`
- Full logs: `pnpm -w typecheck:full`
- Errors only: `pnpm -w typecheck:errors`
- New logs only: `pnpm -w typecheck:new`
- Hash-only logs: `pnpm -w typecheck:hash`
- Debug verbosity: `pnpm -w typecheck:debug`
- Shared package only (full logs): `pnpm -w typecheck:filter:shared`

`pnpm -w typecheck -- ...` is blocked by a guard and fails fast with guidance. Use the wrapper scripts above or run Turbo directly (for example `pnpm -w turbo run typecheck --output-logs=full`).

## Alert thresholds (pilot defaults)
Defaults below are starting points and should be tuned during pilot:
- DLQ rate > 0.5% over 15 minutes
- p95 time-to-draft > 2 minutes over 30 minutes
- Queue oldest job age > 5 minutes
- Gmail 401/403 spikes above normal baseline

## Triage flows

### 1) No drafts being created
Likely causes:
- Global/per-tenant kill switch enabled.
- Queue stalled or worker down.
- Gmail auth/watch invalid.
- Upstream generation failures.

What to check:
- Recent ingest volume vs generated draft count.
- Worker heartbeat and queue processing throughput.
- Kill switch states (global and affected tenants).
- Gmail 401/403/429/5xx and OpenAI error metrics.

What to do next:
- Use least disruptive mitigation first (tenant-scope before global).
- Restore worker/queue health if stalled.
- Re-auth affected mailboxes if auth failure is confirmed.
- Route failed items to DLQ and start scoped replay after fix.

### 2) Queue growing / oldest age increasing
Likely causes:
- Insufficient worker concurrency.
- Provider latency/rate limiting.
- Retry storm from transient failures.

What to check:
- Queue depth trend, oldest age trend, and retry rate.
- Worker process health and recent deploy/config changes.
- Gmail/OpenAI latency and 429/5xx rates.

What to do next:
- Reduce failure amplification (tune retry/backoff, pause noisy tenant if needed).
- Temporarily disable non-critical stages (writeback or OpenAI) if backlog threatens SLA.
- Scale workers only after confirming idempotency and provider limits are respected.

### 3) Gmail auth revoked / 401/403 spike
Likely causes:
- OAuth token invalidation/revocation.
- Scope or consent drift.
- Tenant-specific credential issues.

What to check:
- 401 vs 403 distribution by tenant/mailbox.
- Token refresh failures and last successful auth timestamp.
- Recent admin changes for Gmail connection settings.

What to do next:
- Disable processing per affected tenant to avoid repeated failures.
- Trigger reconnect flow and confirm minimum required scopes.
- Replay only tenant-scoped failed jobs after auth recovery.

### 4) OpenAI failures / latency spike
Likely causes:
- Provider-side latency incident.
- Model quota/rate-limit pressure.
- Prompt/runtime payload regression.

What to check:
- OpenAI error classes, latency percentiles, and throughput drop.
- Retry rates and queue buildup at generation stage.
- Any recent prompt/template/runtime config changes.

What to do next:
- Disable OpenAI path if needed; force human review or holding-template flow.
- Keep ingestion and state tracking running where safe.
- Resume generation gradually and monitor p95 + error rate before full re-enable.

### 5) Duplicate drafts suspected
Likely causes:
- Missing/incorrect idempotency key at one stage.
- Replay scope too broad.
- Provider duplicate delivery not fully deduped.

What to check:
- Dedupe hit metrics and idempotency key logs for affected thread/job.
- Audit trail for replay actions and operator interventions.
- Writeback stage logs for repeated side-effect attempts.

What to do next:
- Freeze writeback for affected tenant if duplicate risk is active.
- Correct idempotency behavior before replay.
- Run scoped replay and verify exactly-once outcomes per thread.

## Mitigations (kill switches)
Use the least disruptive switch first.
- Global stop-the-world: halt all processing when blast radius is unknown or severe.
- Per-tenant processing disable: isolate one tenant without impacting others.
- Disable writeback only: continue upstream processing while preventing draft writes.
- Disable OpenAI only: hold templates or force review while provider stabilizes.
- Force human review mode: allow safe progression without autonomous draft generation.

## Recovery
- DLQ replay:
  - Scope by tenant, mailbox, stage, and time window.
  - Record audit fields: operator, reason, scope, start/end time.
- History-range replay:
  - Use bounded ranges for catch-up after outages.
  - Prefer smallest range that restores consistency.
- Before replaying:
  - Confirm root cause is mitigated.
  - Confirm idempotency checks are active and validated.
- After replaying:
  - Verify no duplicate drafts were produced.
  - Verify checkpoint lag returns to normal.

## Escalation + incident notes template
Escalate when thresholds persist after first mitigation, customer impact is active, or root cause is unknown.

Incident notes template:
- Incident ID:
- Start time / detection time:
- Detection source (alert/manual/customer report):
- Affected tenants/mailboxes:
- Symptoms observed:
- Suspected cause:
- Mitigations applied (with timestamps):
- Kill switches used:
- Replay scope executed:
- Current status:
- Owner:

## Post-incident checklist
- Capture metric screenshots/exports for key windows.
- Record affected tenants/mailboxes/threads and impact summary.
- Build timeline of detection, mitigation, recovery, and close.
- Document decisions made and why.
- Confirm idempotency and replay audit logs are complete.
- Identify permanent fixes and owners.
- Map evidence to Phase 10 proof points:
  - No lost emails during failure window.
  - No duplicate drafts during retries/replay.
  - Controlled mitigation via kill switches.
  - Audited and scoped recovery execution.
