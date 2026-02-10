# Canonical Contracts (Phase 2)
See `docs/architecture/data-model.md` for the minimal data model spec.

## A) Contract principles (1 short section)
- Provider-agnostic core, provider-specific adapters.
- Idempotent by default.
- Guardrails-first.
- Evidence-gated drafting (no guessing).
- Multi-tenant isolation everywhere.

## B) MailProvider contract (conceptual)
Purpose: isolate provider-specific integrations (Gmail now, Outlook later) behind a single interface.

Canonical identifiers:
- `provider` (gmail | outlook)
- `provider_mailbox_id`
- `provider_thread_id`
- `provider_message_id`
- `provider_draft_id`

Required capabilities (inputs/outputs, conceptual):
- Auth lifecycle: connect, refresh, and detect revoke; emit mailbox health state.
- Notification lifecycle:
  - `subscribe` / `startWatch`
  - `validateNotification`
  - `translateNotification` -> canonical MailEvent(s)
  - `resync` / `listRecent` for gap recovery
- Data access:
  - `fetchMessage` (normalized message)
  - `fetchThread` (normalized thread, ordered)
- Draft operations:
  - `createDraftInThread`
  - `updateDraft` (optional)
  - `applyLabel` or tag intent (provider-specific mapping)

Normalized message shape (conceptual fields):
- `from`, `to`, `cc`, `bcc`
- `subject`
- `date`
- `text_body`
- `html_body` (optional)
- `attachments` metadata (filename, mime, size, provider_attachment_id)
- `snippet`

Normalized thread shape (conceptual fields):
- `provider_thread_id`
- `subject`
- ordered `messages[]` (ascending by message date, stable ordering by provider message id as tie-breaker)

Outlook compatibility notes:
- Graph subscriptions map to `subscribe` and `translateNotification`.
- Graph message and thread IDs map to the canonical identifiers above.

## B.1) Gmail-visible state via labels
Namespace and thread labels (v1):
- Parent namespace: `Inbox Copilot`
- State labels:
  - `Inbox Copilot/Ready`
  - `Inbox Copilot/Needs review`
  - `Inbox Copilot/Error`

Semantics:
- Labels are applied at thread scope in v1.
- State labels are mutually exclusive: at most one of Ready / Needs review / Error on a thread.
- Shared code defines canonical state keys: `ready`, `needs_review`, `error`.

When to apply:
- `Ready`: a draft was created/updated successfully and is safe for operator review/sending.
- `Needs review`: sensitive content, user-edited draft protection triggered, or ambiguity requiring human decision.
- `Error`: repeated processing failure, auth revoked, or unrecoverable provider/processing error.

High-level removal rule:
- Replace prior state label when state changes.
- Remove copilot state labels when a thread is considered handled/closed in later lifecycle work (detailed rules in Step 6.7).

## B.2) Eligibility & triage rules (v1)
Decision order (first match wins):
1. Ignore if thread has no messages or latest sender is missing.
2. Ignore if latest message is in `SPAM` or `TRASH`.
3. Ignore if neither thread labels nor latest message labels contain `INBOX`.
4. Route to `needs_review` if a user-edited draft is present.
5. Ignore if latest sender matches a known operator email.
6. Route to `needs_review` as `ambiguous_sender` when operator identity is unavailable.
7. Ignore for no-reply or auto-reply messages.
8. Route to `needs_review` for sensitive refund/cancellation, medical, safety, legal, or exception keywords.
9. Route to `needs_review` for multi-party threads (`to > 1`, or any `cc`/`bcc`).
10. Otherwise mark as draftable (`draft` -> `Ready`).

Examples:
- Guest asks "Can I get a refund?" -> `needs_review` (`sensitive_refund_or_cancellation`)
- Guest says "We have asthma, is this safe?" -> `needs_review` (`sensitive_medical`)
- Operator is the latest sender in thread -> `ignore` (`latest_is_operator_sent`)
- Thread is not in INBOX (archived/out of inbox) -> `ignore` (`not_in_inbox`)
- Simple guest question in INBOX with single recipient -> `draft` (`Ready`)

## B.3) Change ingestion contract (cursor-based)
Canonical label normalization rule:
- Providers MUST normalize system mailbox state labels to canonical values: `INBOX`, `SPAM`, `TRASH`.
- Normalization is case-insensitive and must be available at message/thread level.
- This rule applies even if a provider uses folders or provider-specific IDs (for example, Outlook categories/folders).
- Shared triage rules depend on these canonical labels.

Ingestion algorithm (provider-agnostic, idempotent):
1. Input: `mailboxId` and current mailbox cursor (`Cursor`).
2. Trigger on push notifications and on scheduled backstop polling.
3. Load current cursor for mailbox.
4. Call `provider.listChanges(cursor)`.
5. If `needsFullSync` is true, use bounded resync strategy (defined in later step) before advancing cursor.
6. Derive deduped work items (`messageIds`, `threadIds`) from changes.
7. Enqueue work items with idempotency keys (queue wiring in later step).
8. Persist `nextCursor` only after plan enqueue/processing succeeds.

Replay and idempotency semantics:
- Notifications are at-least-once and change windows may overlap.
- Process each `(mailboxId, messageId)` at most once (enforced later with storage constraints).
- Draft slot identity is `(mailboxId, threadId, draftKind)`.
- Cursor updates are monotonic and written only after safe completion.
- Provider examples: Gmail cursor is `historyId`; Outlook cursor is `delta token`.

## B.4) Copilot draft ownership + fingerprinting (never overwrite)
Marker headers (required when provider supports custom draft headers):
- `X-Inbox-Copilot-Draft-Key`
- `X-Inbox-Copilot-Marker-Version`

Body marker fallback (defensive when providers strip headers):
- HTML comment format: `<!-- inbox-copilot:draftKey=<draftKey>;v=1 -->`
- Keep marker single-line and stable.

Fingerprinting algorithm (high-level):
- Compute `sha256` over a canonical string containing:
  - draft marker key and marker version
  - subject (or empty)
  - plain text body
  - HTML body (or empty)
- Normalize line endings and trim/collapse trailing whitespace-only lines before hashing.
- Output format: `sha256:<hex>`.

Upsert safety rule:
- Provider reads current draft, determines ownership from headers first and body marker fallback second.
- Provider computes `currentFingerprint` from current draft content.
- If marker is missing/invalid OR `expectedPreviousFingerprint` mismatches `currentFingerprint`, return `blocked_user_edited`.
- On `blocked_user_edited`, route thread state to `Needs review` for explicit operator handling.

Draft key identity:
- `draftKey` is a stable thread-scoped identity (for example `mailboxId + threadId + draftKind`), not guest PII.

## B.5) Concurrency, ordering, and idempotency (thread-safe processing)
At-least-once and idempotency:
- Change notifications may replay; all processing paths must be idempotent.
- Message work idempotency unit: `(mailboxId, messageId)`.
- Draft slot idempotency unit: `(mailboxId, threadId, kind="copilot_reply")`.
- Cursor idempotency unit: `(mailboxId, cursor)`; advance only after safe completion.

Thread-scoped single-flight:
- At most one active thread processor per `(mailboxId, threadId)`.
- Draft upserts for a thread are serialized behind this thread key.
- If duplicate thread work arrives while active, runtime may no-op or reschedule.

Ordering rule:
- Always decide draft action from the latest inbound message in the thread.
- Stale work (older message than known latest) must no-op and must not write/update drafts.
- Ties must resolve deterministically with a stable tie-breaker.

Interaction with never-overwrite invariant:
- Before any update, verify ownership markers and fingerprint match.
- If ownership fails or fingerprint mismatches, return `blocked_user_edited`.
- Route blocked updates to `Needs review` and stop draft mutation.

Failure and retry safety:
- Retries are expected and must remain safe under replay.
- Idempotency keys and single-flight expectations prevent duplicate side effects.
- Lock TTLs and heartbeats are runtime concerns; contract requires safe re-entry.

## B.6) Draft lifecycle state machine (v1)
Text diagram:
- Notification
  -> `listChanges(cursor)`
  -> `deriveWorkItems`
  -> thread single-flight `(mailboxId, threadId)`
  -> `getThread`
  -> `triageThreadForCopilot`
  -> `ignore` | `needs_review` | `draft`
  -> if `draft`: check existing draft ownership + fingerprint
  -> `upsert_draft` OR `blocked_user_edited`
  -> apply exclusive state label (`Ready` / `Needs review` / `Error`)

Invariants:
- Never overwrite human edits:
  - missing/invalid marker or fingerprint mismatch must return `blocked_user_edited`.
- Exclusive label states:
  - only one of `Ready`, `Needs review`, `Error` may be present at a time.
- Idempotency units:
  - message: `(mailboxId, messageId)`
  - draft slot: `(mailboxId, threadId, kind="copilot_reply")`
  - thread serialization key: `(mailboxId, threadId)`
- Planner is pure and deterministic:
  - no provider calls, queue calls, or persistence side effects.

Outcome table:
- `ignore` -> `noop` (no draft mutation, no state promotion).
- `needs_review` -> `label_only` with `Needs review`.
- `draft` -> `upsert_draft` intent with `Ready`, reply target, and idempotency keys.
- `blocked_user_edited` -> stop updates and route `Needs review`.

## B.7) Failure, retry, and resync contract (v1)
Failure taxonomy and visibility:
- System/provider failures default to `Error` label state.
- Human/content conflicts default to `Needs review`.
- `draft_conflict_user_edited` must always map to `Needs review` and no retry.

Retry policy (conceptual):
- `backoff` for `rate_limited`, `provider_unavailable`, `provider_timeout`, and `unknown`.
- `immediate` for `invalid_cursor` and `needs_full_sync` to enter resync flow quickly.
- `manual` for `auth_revoked` and `permission_denied`.
- `none` for `message_not_found`, `thread_not_found`, `draft_conflict_user_edited`, `bad_request`.

Resync behavior:
- `needsFullSync=true` or `invalid_cursor` triggers bounded backfill in v1.
- Default bounded backfill window is 7 days.
- Cursor must not advance until resync plan completes safely.
- Runtime should record resync attempts/outcomes for auditing and operations.

Examples:
- Duplicate notification replay -> safe no-op because idempotency keys dedupe work.
- Gmail history gap -> `needs_full_sync` -> bounded backfill (7 days) -> `Error` during remediation.
- Auth revoked -> `auth_revoked` -> `Error` + manual reconnect required.
- Draft blocked due to user edit -> `draft_conflict_user_edited` -> `Needs review`, no retry.
- Provider rate limit -> `rate_limited` -> `Error` + backoff retry.

## C) Event pipeline contract (internal)
Canonical event types:
- `mail.message.received`
- `mail.thread.updated` (optional for v1)
- `mail.processing.started`
- `mail.processing.completed`
- `mail.processing.failed`
- `mail.draft.created`
- `mail.flagged.sensitive`

Event envelope requirements:
- `tenant_id`, `mailbox_id`, `provider`, `correlation_id`
- `occurred_at`, `received_at`
- provider cursor fields (`gmail_history_id` or `outlook_change_key`/event id)

Idempotency and dedupe:
- Event dedupe key stored on ingest: `(tenant_id, mailbox_id, provider_message_id, event_type)`.
- Job idempotency: job id derived from `(tenant_id, mailbox_id, provider_message_id)`.
- Draft idempotency: one draft per `(tenant_id, mailbox_id, provider_message_id)` by default.

Retry semantics:
- Transient errors: retry with exponential backoff and bounded attempts.
- Permanent errors: mark failed with error category and stop retries.
- Operator attention required when auth revoked, repeated rate-limit failures, or repeated provider gaps.

## D) AI boundary contract (guardrails + retrieval + draft)
Inputs:
- Normalized inbound message.
- Thread context selection rules (conceptual): include recent messages, exclude signatures/quoted blocks when possible.
- Tenant voice/settings.
- Retrieved evidence snippets (doc chunk refs + excerpts).
- Allowed action: `draft` vs `review-required`.

Outputs:
- Draft body (plain text; optional HTML notes).
- Optional claims list for audit (statement -> evidence refs).
- Uncertainty or missing-info questions.
- Confidence signal (conceptual).

Guardrails enforcement (outside the model):
- Sensitive classifier runs before drafting.
- Evidence gating thresholds applied before draft creation.
- Forbidden behaviors: invent policies, promise refunds, provide medical/legal advice, or override operator policies.

## E) Observability / audit contract
Required correlation IDs:
- `tenant_id`, `mailbox_id`, `provider_thread_id`, `provider_message_id`, `job_id`, `run_id`.

Audit event requirements:
- Append-only.
- Includes stage, timestamps, outcome, error category, evidence ids, model/version.

Minimum audit events per run:
- notification received
- job enqueued
- processing started
- retrieval complete
- AI complete
- draft created OR sensitive flagged
- processing completed or failed

Metrics (conceptual list):
- time-to-draft
- draft rate
- sensitive rate
- retry rate
- provider error rate
- operator actions (send/edit/discard)

## F) Security & tenancy notes (short)
- Tenant scoping: every read/write is filtered by `tenant_id` with mailbox ownership enforced.
- Data retention: configurable retention window; store only minimal required message data and evidence artifacts.
