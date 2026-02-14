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

Recommended one-time pnpm store configuration:
1. `pnpm config set store-dir ~/.pnpm-store`
2. `pnpm config get store-dir`
This prevents pnpm from creating `.pnpm-store/` in the repo.

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
1. Ensure Redis is running (default path on macOS without Docker; see section below).
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

Log verification snippet:
1. `CID="<correlationId-from-smoke>"`
2. `rg -a "$CID" /tmp/ai-email-api.log | rg -e "notification.received|notification.enqueued"`
3. `rg -a "$CID" /tmp/ai-email-worker.log | rg -e "job.start|job.done|job.error"`

Expected API match example:
`{"event":"notification.received","correlationId":"<CID>","tenantId":"...","docType":"Policies","filename":"correlation-smoke.txt","contentType":"text/plain","sizeBytes":23}`
`{"event":"notification.enqueued","correlationId":"<CID>","tenantId":"...","queueName":"docs_ingestion","jobId":"1"}`

Expected worker match example:
`{"event":"job.start","correlationId":"<CID>","jobId":"1","attempt":1,"maxAttempts":3,"tenantId":"...","stage":"doc_ingestion","queueName":"docs_ingestion"}`
`{"event":"job.done","correlationId":"<CID>","jobId":"1","attempt":1,"maxAttempts":3,...}`

## One-command local dev
Use this for a single-command bring-up/tear-down loop:
1. `pnpm -w dev:up`
2. Wait for the exact ready line:
   `OK dev:up ready apiUrl=http://127.0.0.1:3001 healthz=200 apiLog=... workerLog=... keepLogs=...`
3. In a new terminal: `pnpm -w smoke:correlation`
4. Stop with Ctrl+C in the `dev:up` terminal, or run `pnpm -w dev:down`

Useful overrides:
- `AI_EMAIL_API_LOG` and `AI_EMAIL_WORKER_LOG` to change default log files.
- `KEEP_LOGS=1` to preserve existing log content (default behavior truncates logs on `dev:up` start).
- `DEV_UP_TIMEOUT_MS` to change API readiness timeout (default `20000`).
- `WORKER_READY_TIMEOUT_MS` to change worker readiness soft timeout (default `10000`).
- `SMOKE_LOG_TIMEOUT_MS` to extend/reduce smoke log polling timeout.
- `SKIP_DB_SETUP=1` to skip DB bootstrap when your DB is already ready.

Log hygiene and readiness behavior:
- By default, `dev:up` truncates `AI_EMAIL_API_LOG` and `AI_EMAIL_WORKER_LOG` before launching API/worker to avoid stale incident/smoke IDs.
- At startup, `dev:up` best-effort cleans stale `.tmp/dev-processes.json` process state before launching new processes.
- `dev:up` now deterministically owns port `3001`: it attempts `SIGTERM`, then `SIGKILL` for existing listeners, and re-checks before booting API.
- `dev:up` blocks on API `/healthz` readiness and fails fast with:
  `FAIL dev:up api-not-ready timeoutMs=<...>`
  plus last API log lines when the timeout is exceeded.
- Worker readiness is soft-gated: if not ready in time, `dev:up` prints a warning and continues.

If `dev:up` cannot reclaim `:3001`, it exits non-zero with PID diagnostics and manual fallback commands:
1. `lsof -nP -iTCP:3001 -sTCP:LISTEN`
2. `kill <pid1> <pid2> ...`
3. `kill -9 <pid1> <pid2> ...`

## Retry + Error Taxonomy (v1)
Shared defaults (single source of truth in `@ai-email/shared`):
- Retries: `attempts=3`
- Backoff: exponential with base delay `500ms` and cap `30,000ms` (`computeBackoffMs(attempt)` also provided for custom retry contexts)
- BullMQ defaults: `backoff.type='exponential'`, `backoff.delay=500`, `removeOnComplete={count:1000}`, `removeOnFail={count:5000}`

Error classification (`classifyError`):
- `TRANSIENT`: network retryable codes (`ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, `ECONNREFUSED`), HTTP `408/429/5xx`, and transient Postgres SQLSTATE (`40001`, `40P01`, `53300`, `57P01`, `08006`, `08001`)
- `PERMANENT`: non-retryable cases by default (including other `4xx`)
- `IGNORE`: duplicate/already-exists signals (for example duplicate key conflicts)

DLQ note:
- Permanent failures are currently terminal; explicit DLQ routing is planned for Step `10.8.2` and is not implemented in this step.

### Retry semantics
- `TRANSIENT` errors are retried by BullMQ up to configured attempts.
- `PERMANENT` errors fail fast and are not retried (worker throws `UnrecoverableError`).
- Worker `job.error` logs include `errorClass` so retry-vs-fail-fast decisions are visible in operations logs.

### Kill switches
Use kill switches to stop docs ingestion quickly during pilot incidents.

Global kill switch:
- Set `DOCS_INGESTION_DISABLED=1` before starting API/worker.
- Effect: docs upload/retry endpoints return `503` with `error: "Docs ingestion disabled"` and no doc write/enqueue side effects.
- Expected logs: `notification.rejected` with `reason="kill_switch_global"` (API), `job.ignored` with `reason="kill_switch_global"` (worker).

Preferred kill switch command (recommended):
- Dry run (no write): `DATABASE_URL="postgresql://127.0.0.1:5432/ai_email_dev" TENANT_ID="00000000-0000-0000-0000-000000000001" KEY="docs_ingestion" IS_ENABLED="1" REASON="incident mitigation" pnpm -w kill-switch:set`
- Apply enable: `DATABASE_URL="postgresql://127.0.0.1:5432/ai_email_dev" TENANT_ID="00000000-0000-0000-0000-000000000001" KEY="docs_ingestion" IS_ENABLED="1" REASON="incident mitigation" KILL_SWITCH_CONFIRM=1 pnpm -w kill-switch:set`
- Apply disable: `DATABASE_URL="postgresql://127.0.0.1:5432/ai_email_dev" TENANT_ID="00000000-0000-0000-0000-000000000001" KEY="docs_ingestion" IS_ENABLED="0" REASON="recovered" KILL_SWITCH_CONFIRM=1 pnpm -w kill-switch:set`

Per-tenant kill switch SQL fallback (Postgres):
- Enable for local default tenant:
  - `psql "$DATABASE_URL" -c "INSERT INTO tenant_kill_switches (tenant_id, key, is_enabled, reason, updated_at) VALUES ('00000000-0000-0000-0000-000000000001', 'docs_ingestion', true, 'incident mitigation', now()) ON CONFLICT (tenant_id, key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, reason = EXCLUDED.reason, updated_at = now();"`
- Disable for that tenant:
  - `psql "$DATABASE_URL" -c "INSERT INTO tenant_kill_switches (tenant_id, key, is_enabled, reason, updated_at) VALUES ('00000000-0000-0000-0000-000000000001', 'docs_ingestion', false, null, now()) ON CONFLICT (tenant_id, key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, reason = EXCLUDED.reason, updated_at = now();"`
- Expected logs: `notification.rejected` with `reason="kill_switch_tenant"` (API), `job.ignored` with `reason="kill_switch_tenant"` (worker).

### Replay failed jobs (manual)
Use this after deploying a fix or recovering from transient incidents when you need explicit, operator-controlled replay of failed jobs.

Commands:
- List candidates only (dry run): `REDIS_URL=redis://127.0.0.1:6379 pnpm -w queue:replay`
- Filter by correlation: `CORRELATION_ID=<correlation-id> pnpm -w queue:replay`
- Replay (explicit confirm required): `REPLAY_CONFIRM=1 CORRELATION_ID=<correlation-id> pnpm -w queue:replay`
- Filter by tenant and recent window: `TENANT_ID=<tenant-id> SINCE_MINUTES=60 LIMIT=100 pnpm -w queue:replay`

Defaults and safety:
- Default queue is `docs_ingestion` (override with `QUEUE_NAME`).
- The script never replays unless `REPLAY_CONFIRM=1`.
- The script never deletes jobs in this step.

After replay:
- Verify by correlation in logs:
  - `rg -a "<correlationId>" /tmp/ai-email-api.log`
  - `rg -a "<correlationId>" /tmp/ai-email-worker.log`
- Re-run `pnpm -w smoke:correlation` for end-to-end sanity if needed.

### Idempotency and de-dupe (docs ingestion)
- Docs ingestion queue job id is deterministic by doc id: `docs_ingestion-<docId>`.
- API retry endpoint rejects already-ingested docs (`ingestion_status=done`) with deterministic client error (`Doc already ingested`) and does not enqueue new work.
- Worker short-circuits duplicate work: if a doc is already `processing`, `done`, or `ignored`, it emits `job.ignored` and exits successfully without side effects.
- `queue:replay` remains safe with deterministic job ids; use `failures:list` / `failures:show` for root-cause inspection before replaying.
- Manual retry check (after doc is done): `curl -sS -X POST -H "x-tenant-id: <tenant-id>" "http://127.0.0.1:3001/v1/docs/<docId>/retry"`

### Unstick docs ingestion (stuck processing)
Use this when docs stay in `processing` after worker crashes/restarts and never progress.

Default dry run (safe by default):
- `DATABASE_URL="postgresql://127.0.0.1:5432/ai_email_dev" TENANT_ID="00000000-0000-0000-0000-000000000001" THRESHOLD_MINUTES="60" pnpm -w docs:unstick`

Confirm/apply:
- `DATABASE_URL="postgresql://127.0.0.1:5432/ai_email_dev" TENANT_ID="00000000-0000-0000-0000-000000000001" THRESHOLD_MINUTES="60" DOCS_UNSTICK_CONFIRM=1 pnpm -w docs:unstick`

Notes:
- Defaults move stuck docs to `failed` (safer for operator review and explicit replay). Use `SET_STATUS=queued` only when intentionally re-queueing without replay.
- Follow-up checks: `pnpm -w ops:triage`, `pnpm -w failures:list`, `pnpm -w queue:status`.
- Recovery options after unstick:
  - `SET_STATUS=failed`: use `pnpm -w queue:replay` (with filters) or doc retry endpoint per doc id.
  - `SET_STATUS=queued`: worker can pick up work directly once queue/job state permits.
- Prefer this command-first path; use direct SQL only if command execution is unavailable.

### Queue status (read-only)
Use this command for a deterministic queue snapshot (counts + active + recent failed samples):
- `REDIS_URL="redis://127.0.0.1:6379" pnpm -w queue:status`
- Filtered example: `REDIS_URL="redis://127.0.0.1:6379" TENANT_ID="00000000-0000-0000-0000-000000000001" LIMIT=10 pnpm -w queue:status`

What the output means:
- `queue.counts` line gives queue-level totals (`waiting`, `active`, `delayed`, `failed`, `completed`).
- `queue.active` lines are active samples ordered oldest-first (`ageMs` helps identify stuck work).
- `queue.failed` lines are recent failed samples (bounded by `SINCE_MINUTES`, default `60`) with truncated reasons.

### Pause / Resume queue
Use pause/resume to hold or release backlog processing without dropping jobs. This complements kill switches: pause holds processing, while kill switches block side effects.

Commands:
- Dry-run pause: `REDIS_URL="redis://127.0.0.1:6379" pnpm -w queue:pause`
- Confirm pause: `REDIS_URL="redis://127.0.0.1:6379" QUEUE_CONTROL_CONFIRM=1 pnpm -w queue:pause`
- Read current status: `REDIS_URL="redis://127.0.0.1:6379" pnpm -w queue:is-paused`
- Confirm resume: `REDIS_URL="redis://127.0.0.1:6379" QUEUE_CONTROL_CONFIRM=1 pnpm -w queue:resume`

Queue override:
- Set `QUEUE_NAME` to operate on a queue other than `docs_ingestion`.

### Failure triage: docs ingestion failures
Use operator commands first to find what failed and why (tenant-scoped, read-only):
- List recent failures: `DATABASE_URL="postgresql://127.0.0.1:5432/ai_email_dev" TENANT_ID="00000000-0000-0000-0000-000000000001" pnpm -w failures:list`
- Filter by correlation: `DATABASE_URL="postgresql://127.0.0.1:5432/ai_email_dev" TENANT_ID="00000000-0000-0000-0000-000000000001" CORRELATION_ID="<cid>" pnpm -w failures:list`
- Show one failure by job id: `DATABASE_URL="postgresql://127.0.0.1:5432/ai_email_dev" TENANT_ID="00000000-0000-0000-0000-000000000001" JOB_ID="<job-id>" pnpm -w failures:show`

### Triage (one command)
Use this read-only snapshot command during incidents to answer kill switch, queue, and recent failure state for one tenant.

Default command:
- `REDIS_URL="redis://127.0.0.1:6379" DATABASE_URL="postgresql://127.0.0.1:5432/ai_email_dev" TENANT_ID="00000000-0000-0000-0000-000000000001" pnpm -w ops:triage`

Filter by correlation id:
- `REDIS_URL="redis://127.0.0.1:6379" DATABASE_URL="postgresql://127.0.0.1:5432/ai_email_dev" TENANT_ID="00000000-0000-0000-0000-000000000001" CORRELATION_ID="<cid>" pnpm -w ops:triage`

What good output looks like:
- `ops.triage.killSwitch.global` shows `disabled=false`.
- `ops.triage.killSwitch.tenant` shows `status=not_set` or `isEnabled=false`.
- `ops.triage.queue.isPaused` shows `isPaused=false`.
- `ops.triage.queue.counts` shows bounded `waiting/active/failed/delayed`.
- `ops.triage.failures.count` is stable and samples are explainable.
- Final line is `OK ops:triage ...`.

Where to look next if not healthy:
- Queue control: `pnpm -w queue:pause`, `pnpm -w queue:resume`, `pnpm -w queue:is-paused`
- Kill switch control: `pnpm -w kill-switch:set` (safe-by-default dry-run unless confirm is set)
- Failure detail: `pnpm -w failures:list`, `pnpm -w failures:show`

Operator decision guide:
- `errorClass=TRANSIENT`: watch `queue:status`, verify dependencies, and allow normal retries/replay path.
- `errorClass=PERMANENT`: enable kill switch, fix root cause, then use `queue:replay` with strict filters to recover safely.

## CI
GitHub Actions workflow `CI` runs:
1. `pnpm -w repo:check`
2. `pnpm -w db:migrate` against Docker service Postgres 16 + pgvector
3. API + worker startup and `pnpm -w smoke:correlation` deterministic verification

On failures, go to GitHub Actions run details and open Artifacts:
- `ci-smoke-logs` includes `/tmp/ai-email-api.log`, `/tmp/ai-email-worker.log`, and PID files.

## Make CI required on main
In GitHub:
1. `Settings` -> `Branches` -> `Branch protection rules` -> `Add rule` for `main`.
2. Enable `Require status checks to pass before merging`.
3. Select required status check `CI / smoke-gate`.
4. Enable `Require branches to be up to date before merging` (recommended).
5. Optionally enable `Require a pull request before merging` and PR reviews.

## Branch protection (required)
For exact setup/troubleshooting steps, see `docs/runbooks/branch-protection.md`.

## Redis (macOS, no Docker)
Use this as the default local setup path when Docker is unavailable:
1. `brew install redis`
2. `brew services start redis`
3. `redis-cli ping`

Expected response: `PONG`

Optional Docker-based infra path:
- `pnpm dev:infra`

## Local DB (Postgres) setup
Use the repo bootstrap to avoid PATH and readiness guesswork:
1. `pnpm -w db:setup`
2. Copy the `export DATABASE_URL="..."` line printed by the script and run it in your shell.

`db:setup` does all of the following:
- Starts/ensures Homebrew Postgres service (`postgresql@16`).
- Waits for readiness on TCP and `/tmp` socket paths.
- Creates `ai_email_dev` if missing.
- Runs repo migrations (`pnpm -w db:migrate`).
- Detects Postgres major from `psql --version` and verifies extension availability with:
  `psql -h 127.0.0.1 -d postgres -c "select name from pg_available_extensions where name='vector'"`.
- If `vector` is missing on `postgresql@16`, it installs `pgvector`, resolves `pg_config` via `brew --prefix postgresql@16` (`<prefix>/bin/pg_config`), builds pgvector from source (`make PG_CONFIG=...` + `make install PG_CONFIG=...`), restarts `postgresql@16`, and re-verifies.
- If `vector.control` is missing from Homebrew files, it prints:
  `brew list pgvector | rg 'vector\.control|vector--|extension'`
  and suggests `brew reinstall pgvector` (or using a Docker Postgres image with pgvector), then exits non-zero.
- Before success exit, it runs the same `pg_available_extensions` verification query again and fails non-zero if `vector` is still unavailable.
- Prints the exact `DATABASE_URL` for your environment.

## Local storage mode (no AWS/S3 required)
Fully green local smoke sequence (Redis + Postgres + local docs):
1. `pnpm -w db:setup`
2. `export DATABASE_URL="..."` (copy the exact value printed by `db:setup`)
3. `export REDIS_URL=redis://127.0.0.1:6379`
4. `export DOCS_STORAGE=local`
5. `export DOCS_LOCAL_DIR=/tmp/ai-email-docs` (optional; default is `<repo>/.tmp/docs`)
6. `export TENANT_AUTOSEED=1` (dev-only; enables automatic tenant seed on docs ingest)
7. Terminal A: `pnpm -w --filter @ai-email/api dev 2>&1 | tee /tmp/ai-email-api.log`
8. Terminal B: `pnpm -w --filter @ai-email/worker dev 2>&1 | tee /tmp/ai-email-worker.log`
9. Terminal C: `pnpm -w smoke:correlation 2>&1 | tee /tmp/ai-email-smoke.log`
10. Terminal C:
    `CID="$(perl -ne 'if(/correlationId=([A-Za-z0-9_-]+)/){print $1; exit}' /tmp/ai-email-smoke.log)"`
11. Terminal C:
    `echo "CID=$CID"`
12. Terminal C:
    `rg "$CID" /tmp/ai-email-api.log`
13. Terminal C:
    `rg -a "$CID" /tmp/ai-email-worker.log`

DB note:
- `DATABASE_URL` must point to a reachable Postgres with migrations applied.
- If DB config is wrong, API logs include underlying DB `errorMessage` and `errorCode` for docs record writes.

Grep tip for worker logs:
- `/tmp` log files piped through `tee` may be detected as binary by `rg`; use `rg -a "$CID" /tmp/ai-email-worker.log`.

Expected local file location:
- If `DOCS_LOCAL_DIR` is set: `<DOCS_LOCAL_DIR>/tenants/<tenantId>/docs/<docId>/<filename>`
- Default path: `.tmp/docs/tenants/<tenantId>/docs/<docId>/<filename>` at the repo root.

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
