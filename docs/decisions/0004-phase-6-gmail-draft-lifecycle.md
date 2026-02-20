# DR-0004: Phase 6 — Gmail Draft Lifecycle Contracts

## Status
Accepted

## Context
Phase 6 defines the contract layer for reliable Gmail thread drafting without auto-send. The objective is deterministic, multi-tenant, human-in-control behavior that works now for Gmail and can map to Outlook later without core rewrites.

## Decisions (frozen)
1. MailProvider abstraction includes cursor-based change feed and thread/draft contract; `Cursor` unifies Gmail `historyId` and Outlook delta token (`packages/shared/src/mail/provider.ts`).
2. Gmail-visible state is expressed with exclusive thread labels:
   - `Inbox Copilot/Ready`
   - `Inbox Copilot/Needs review`
   - `Inbox Copilot/Error`
   (`packages/shared/src/mail/labels.ts`, `docs/architecture/contracts.md` B.1).
3. Eligibility/triage is conservative and explainable; sensitive and ambiguous cases route `Needs review` (`packages/shared/src/mail/rules.ts`, B.2).
4. Providers must normalize canonical system labels (`INBOX`/`SPAM`/`TRASH`, case-insensitive) for portable triage behavior (`packages/shared/src/mail/ingestion.ts`, B.3).
5. Never-overwrite invariant is enforced by marker + fingerprint:
   - `X-Inbox-Copilot-Draft-Key`
   - `X-Inbox-Copilot-Marker-Version`
   - `sha256` draft fingerprint
   - `blocked_user_edited` result routes `Needs review`
   (`packages/shared/src/mail/drafts.ts`, B.4).
6. Concurrency/idempotency are thread-safe and deterministic:
   - message unit `(mailboxId,messageId)`
   - draft slot `(mailboxId,threadId,kind)`
   - cursor safety `(mailboxId,cursor)`
   (`packages/shared/src/mail/concurrency.ts`, B.5).
7. Lifecycle planning is deterministic and compositional: triage -> state labels -> idempotency keys -> ownership/fingerprint checks -> lifecycle outcome (`packages/shared/src/mail/lifecycle.ts`, B.6).
8. Failure taxonomy is explicit with retry class and bounded resync defaults (7-day backfill) (`packages/shared/src/mail/failures.ts`, B.7).
9. Telemetry schema and envelope are canonical for evidence and PMF measurement (`packages/shared/src/telemetry/*`, B.8).
10. Watch/subscription management remains outside MailProvider (Option A) in integration/service layer runtime code.

## Consequences
- Runtime Gmail implementation can proceed with low design risk and consistent invariants.
- Outlook support remains feasible by implementing provider adapter mappings to canonical contracts.
- Contracts prioritize trust/reliability over aggressive automation.
- Several capabilities remain deferred to Phase 7 runtime implementation.

## Follow-ups / Deferred
- Runtime Gmail Pub/Sub watch handler + cursor storage and renewal logic.
- BullMQ worker/runtime wiring and DB-backed idempotency enforcement.
- Operator-facing onboarding flows for OAuth and document ingestion.
