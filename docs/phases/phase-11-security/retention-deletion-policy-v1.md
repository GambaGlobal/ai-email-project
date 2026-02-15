# Phase 11.4 - Retention & Deletion Policy (v1)

## A) Purpose + Scope

Purpose:
- Define what data is stored, for how long, and how deletion is handled.
- Provide a clear baseline for operator trust reviews, security questionnaires, and implementation guardrails.

Scope:
- Operator knowledge docs and derived retrieval artifacts
- Draft artifacts and message/thread metadata
- Classification/review outcomes
- Logs, metrics, traces, queue payloads
- OAuth tokens and related connection state
- Audit events
- Backups and optional debug artifacts

## B) Guiding Principles

- Minimize by default and retain only what is needed for product operation and support.
- Retention should support operator workflows and dispute resolution without long-term hoarding.
- Deletion must be tenant-scoped, traceable, and verifiable.
- Backup systems are not surgically editable; deleted primary data may persist in backups until aging out.

## C) Default Retention Table

| Data type / object | Stored system | Default retention | Rationale | Contains PII? | Notes |
| --- | --- | --- | --- | --- | --- |
| Operator knowledge docs (original uploads) | S3-compatible + Postgres metadata | Until deleted by operator | Operator-owned source content for drafting | Maybe | Tenant-scoped; deletion removes primary source. |
| Doc chunks + embeddings | Postgres (+ pgvector) | Until source doc deleted + 7-day grace window | Supports retrieval quality + short rollback window | Maybe | Derived artifacts tied to source doc lifecycle. |
| Draft records (generated text + citations + status) | Postgres | 180 days | Operator review traceability and support investigations | Maybe | v1 drafts are human-reviewed and never auto-sent. |
| Gmail drafts | Gmail (operator account) | Controlled by operator Gmail retention | Draft object lives in operator mailbox | Maybe | We do not control Gmail mailbox retention; we store IDs/status only. |
| Message/thread identifiers + minimal metadata (`messageId`, `threadId`, sender/recipient refs, date, subject hash) | Postgres | 180 days | Routing, dedupe, and draft lifecycle support | Maybe | Raw email body not persisted by default (see Step 11.1). |
| Classification results / review flags | Postgres | 180 days | Safety/routing explainability and review outcomes | Maybe | Payload-minimized structured outcomes only. |
| Audit events (security-relevant) | Postgres/log pipeline | 1 year | Security accountability and incident investigations | Maybe | Payload-minimized event metadata only. |
| System logs (PII-redacted) | Log platform | 30 days | Operational troubleshooting with minimized exposure | Maybe | Never log bodies, attachments, tokens, or secrets. |
| Metrics/aggregates (no PII) | Metrics/telemetry platform | 13 months | Trend analysis and reliability reporting | N | Aggregated counters/percentiles only. |
| Queue job payloads | Redis (BullMQ) | Ephemeral; removed on completion | Short-lived processing transport | Maybe | Failure retention stores metadata only, no raw bodies. |
| OAuth refresh tokens | Token store (tenant-scoped encrypted records) | Until disconnect/revoke | Required to refresh provider access | N/Maybe | Immediate deletion on disconnect/revoke per Step 11.3. |
| OAuth access tokens | In-memory/ephemeral cache | Not persisted; minutes if cached | Short-lived provider access | N/Maybe | Avoid persistent storage. |
| Backups (primary stores) | Backup system | 35 days | Disaster recovery | Maybe | Encrypted, access-limited, age-out deletion model. |

## D) Deletion Workflows

### 1) Operator deletes a knowledge doc

Required actions:
1. Delete source document object from S3-compatible storage.
2. Delete linked doc metadata, chunks, embeddings, and citations referencing that doc.
3. Emit audit event for document deletion and cascade completion.
4. Complete deletion workflow within 24 hours.

### 2) Mailbox disconnect (operator revokes access/disconnects)

Required actions:
1. Revoke provider tokens where supported.
2. Delete local refresh-token ciphertext immediately and mark connection disabled.
3. Stop new mailbox processing jobs for that connection and purge token caches.
4. Retain non-token records per table defaults (for example draft metadata/audit records) unless tenant requests full deletion.

What remains and why:
- Historical draft metadata, identifiers, and audit records may remain for the configured retention windows to support operational traceability and incident review.

### 3) Tenant deletion request ("Right to delete")

Definition:
- Delete tenant means purging tenant-scoped data from primary systems, including docs, embeddings, drafts, metadata, and connection/token material.
- Audit events are deleted where policy/legal basis permits full purge for the tenant.

SLA:
- Primary-system purge target: within 7 days of confirmed request.
- Backup copies: age out and become unrecoverable within 35 days.

## E) Backups and Disaster Recovery Disclosure

- Backup retention window is 35 days by default.
- Backups are encrypted and access-limited.
- Data deleted from primary systems can persist in backups until backup expiration.
- Backups are used for disaster recovery restore workflows only, not routine product access.

## F) Optional Debug Retention Window (Off by Default)

Policy posture:
- Optional debug retention is planned and not available in v1.
- If introduced later and enabled explicitly by a tenant, default window is 7 days.

If enabled in future:
- Capture only minimal bounded email snapshot data needed for troubleshooting.
- Continue to exclude attachments by default unless explicitly enabled with separate controls.
- Require explicit tenant-level on/off control and clear disclosure.

## G) Verification + Auditability

Deletion proof model:
- Emit deletion/audit events for key deletion actions.
- Provide internal tenant-scoped evidence checks (for example record counts reduced to zero for target objects) without exposing other tenants.
- Optional deletion confirmation export may be added in a future phase.

## H) Cross-References

- Data map and minimization baseline: `docs/phases/phase-11-security/data-map-classification-v1.md` (Step 11.1)
- Tenant boundary enforcement requirements: `docs/phases/phase-11-security/tenant-isolation-requirements-v1.md` (Step 11.2)
- Token and secrets lifecycle posture: `docs/phases/phase-11-security/token-storage-secrets-posture-v1.md` (Step 11.3)

## I) Open Questions / Follow-Ups

- Which retention settings, if any, become tenant-configurable in v1 vs v1.1.
- Additional regulatory retention/deletion requirements for EU/UK operators and whether DPA/legal language should mirror this policy in customer-facing documents.
