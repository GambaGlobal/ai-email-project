# Phase 12 Closeout: Product Engine Completion

## A) Decision Record (reference)
- Canonical DR: [`../../decisions/0013-phase-12-rebaseline-product-engine.md`](../../decisions/0013-phase-12-rebaseline-product-engine.md)
- Summary: Phase 12 locked product-engine completion on deterministic queue stages, exactly-once boundaries, kill-switch safety, and DLQ/replay operations.

## B) Success Metrics + Evidence Gate
Big outcome: **Every eligible inbound email reliably produces the correct Gmail draft (exactly-once) with safe fallbacks.**

| Metric | Evidence Gate (How To Verify) | Evidence |
| --- | --- | --- |
| Exactly-once draft behavior (no duplicate draft for same idempotency key) | Run worker tests proving deterministic stage job IDs and marker-based upsert behavior. | [`../../../apps/worker/src/pipeline/stages.test.ts`](../../../apps/worker/src/pipeline/stages.test.ts), [`../../../packages/mail-gmail/src/gmail-provider.test.ts`](../../../packages/mail-gmail/src/gmail-provider.test.ts), commits [`43abd3074a595ce9cac76a7f95b61c2b737597f1`](https://github.com/GambaGlobal/ai-email-project/commit/43abd3074a595ce9cac76a7f95b61c2b737597f1), [`6c312b16ae8a4af8c9d4596c72be7d514356268c`](https://github.com/GambaGlobal/ai-email-project/commit/6c312b16ae8a4af8c9d4596c72be7d514356268c) |
| Deterministic intake on non-commit runs | Verify same cursor + `commitCursor=false` returns identical outputs and leaves cursor unchanged. | [`../../../apps/worker/src/mailbox-sync.test.ts`](../../../apps/worker/src/mailbox-sync.test.ts), commit [`95de301906eb619e912508abbdae3cd7e32dc0d2`](https://github.com/GambaGlobal/ai-email-project/commit/95de301906eb619e912508abbdae3cd7e32dc0d2) |
| Thread-correct writeback | Verify draft create/update calls include correct `threadId` and only update marker-owned drafts. | [`../../../packages/mail-gmail/src/gmail-provider.ts`](../../../packages/mail-gmail/src/gmail-provider.ts), [`../../../packages/mail-gmail/src/gmail-provider.test.ts`](../../../packages/mail-gmail/src/gmail-provider.test.ts), commit [`43abd3074a595ce9cac76a7f95b61c2b737597f1`](https://github.com/GambaGlobal/ai-email-project/commit/43abd3074a595ce9cac76a7f95b61c2b737597f1) |
| Kill switch blocks writes within refresh window | Verify kill-switch service refresh interval and writeback/label enforcement tests pass. | [`../../../apps/worker/src/pipeline/kill-switch.ts`](../../../apps/worker/src/pipeline/kill-switch.ts), [`../../../apps/worker/src/pipeline/kill-switch.test.ts`](../../../apps/worker/src/pipeline/kill-switch.test.ts), [`../../../apps/worker/src/pipeline/stages.test.ts`](../../../apps/worker/src/pipeline/stages.test.ts), commit [`cbcfbf8a3ce329aab57e8dc6aadf754303201dc0`](https://github.com/GambaGlobal/ai-email-project/commit/cbcfbf8a3ce329aab57e8dc6aadf754303201dc0) |
| DLQ + safe replay | Verify permanent errors are captured in DLQ and replay re-enqueues deterministic stage job IDs. | [`../../../apps/worker/src/pipeline/dlq.ts`](../../../apps/worker/src/pipeline/dlq.ts), [`../../../apps/worker/src/pipeline/execution.ts`](../../../apps/worker/src/pipeline/execution.ts), [`../../../apps/worker/src/pipeline/replay.ts`](../../../apps/worker/src/pipeline/replay.ts), commit [`112a7b017a642cb4729d54906998caa4a7bdb92b`](https://github.com/GambaGlobal/ai-email-project/commit/112a7b017a642cb4729d54906998caa4a7bdb92b) |

## C) Milestone Map (Complete)
| Milestone | Why It Matters | Evidence |
| --- | --- | --- |
| Rebaseline source-of-truth docs | Removes doc/implementation drift and anchors phase status to evidence. | [`../../decisions/0013-phase-12-rebaseline-product-engine.md`](../../decisions/0013-phase-12-rebaseline-product-engine.md), [`../../phases.md`](../../phases.md), commit [`3be3fbc8b4ea1cbcdc57c8fb54a8033b8f53b01b`](https://github.com/GambaGlobal/ai-email-project/commit/3be3fbc8b4ea1cbcdc57c8fb54a8033b8f53b01b) |
| Deterministic Gmail intake + thread normalization | Ensures pipeline consumes stable change sets and full thread context for triage/generation. | [`../../../apps/worker/src/mailbox-sync.ts`](../../../apps/worker/src/mailbox-sync.ts), [`../../../packages/mail-gmail/src/gmail-provider.ts`](../../../packages/mail-gmail/src/gmail-provider.ts), commits [`95de301906eb619e912508abbdae3cd7e32dc0d2`](https://github.com/GambaGlobal/ai-email-project/commit/95de301906eb619e912508abbdae3cd7e32dc0d2), [`58583a8228194e17e2a32fd365be96d4fe63e982`](https://github.com/GambaGlobal/ai-email-project/commit/58583a8228194e17e2a32fd365be96d4fe63e982) |
| Idempotent thread-correct draft upsert + state labels | Guarantees safe reruns and clear Gmail-visible state outcomes. | [`../../../packages/mail-gmail/src/gmail-provider.ts`](../../../packages/mail-gmail/src/gmail-provider.ts), [`../../../packages/shared/src/mail/provider.ts`](../../../packages/shared/src/mail/provider.ts), commits [`43abd3074a595ce9cac76a7f95b61c2b737597f1`](https://github.com/GambaGlobal/ai-email-project/commit/43abd3074a595ce9cac76a7f95b61c2b737597f1), [`88f699ed2bebe792e13cee9330cdd07d6942e214`](https://github.com/GambaGlobal/ai-email-project/commit/88f699ed2bebe792e13cee9330cdd07d6942e214) |
| Runtime queue stage wiring | Converts documented pipeline to executable worker stages with deterministic job identity. | [`../../../apps/worker/src/pipeline/stages.ts`](../../../apps/worker/src/pipeline/stages.ts), [`../../../apps/worker/src/index.ts`](../../../apps/worker/src/index.ts), commit [`6c312b16ae8a4af8c9d4596c72be7d514356268c`](https://github.com/GambaGlobal/ai-email-project/commit/6c312b16ae8a4af8c9d4596c72be7d514356268c) |
| Safety controls + failure recovery | Keeps human-in-control via kill switches and durable recovery via DLQ/replay. | [`../../../apps/worker/src/pipeline/kill-switch.ts`](../../../apps/worker/src/pipeline/kill-switch.ts), [`../../../apps/worker/src/pipeline/dlq.ts`](../../../apps/worker/src/pipeline/dlq.ts), commits [`cbcfbf8a3ce329aab57e8dc6aadf754303201dc0`](https://github.com/GambaGlobal/ai-email-project/commit/cbcfbf8a3ce329aab57e8dc6aadf754303201dc0), [`112a7b017a642cb4729d54906998caa4a7bdb92b`](https://github.com/GambaGlobal/ai-email-project/commit/112a7b017a642cb4729d54906998caa4a7bdb92b) |

## D) Step Backlog Summary (12.1-12.8)
1. **12.1** Goal: rebaseline DR + phase index source-of-truth.  
Acceptance: DR added, phases index locked, ledger updated.  
Evidence: [`../../decisions/0013-phase-12-rebaseline-product-engine.md`](../../decisions/0013-phase-12-rebaseline-product-engine.md), [`../../phases.md`](../../phases.md), commit [`3be3fbc8b4ea1cbcdc57c8fb54a8033b8f53b01b`](https://github.com/GambaGlobal/ai-email-project/commit/3be3fbc8b4ea1cbcdc57c8fb54a8033b8f53b01b).

2. **12.2** Goal: implement Gmail history-based change listing + cursor strategy.  
Acceptance: deterministic listChanges, commit-controlled cursor, pagination tested.  
Evidence: [`../../../apps/worker/src/mailbox-sync.ts`](../../../apps/worker/src/mailbox-sync.ts), [`../../../apps/worker/src/mailbox-sync.test.ts`](../../../apps/worker/src/mailbox-sync.test.ts), [`../../../packages/mail-gmail/src/gmail-provider.ts`](../../../packages/mail-gmail/src/gmail-provider.ts), commit [`95de301906eb619e912508abbdae3cd7e32dc0d2`](https://github.com/GambaGlobal/ai-email-project/commit/95de301906eb619e912508abbdae3cd7e32dc0d2).

3. **12.3** Goal: add deterministic Gmail thread normalization for triage context.  
Acceptance: provider-agnostic normalized thread shape, stable ordering, participant dedupe, body extraction tested.  
Evidence: [`../../../packages/shared/src/mail/types.ts`](../../../packages/shared/src/mail/types.ts), [`../../../packages/mail-gmail/src/gmail-provider.ts`](../../../packages/mail-gmail/src/gmail-provider.ts), [`../../../apps/worker/src/mailbox-sync-thread-context.test.ts`](../../../apps/worker/src/mailbox-sync-thread-context.test.ts), commit [`58583a8228194e17e2a32fd365be96d4fe63e982`](https://github.com/GambaGlobal/ai-email-project/commit/58583a8228194e17e2a32fd365be96d4fe63e982).

4. **12.4** Goal: implement thread-correct idempotent Gmail draft upsert.  
Acceptance: marker-based create/update behavior, no duplicate owned draft on rerun, missing-recipient typed failure.  
Evidence: [`../../../packages/mail-gmail/src/gmail-provider.ts`](../../../packages/mail-gmail/src/gmail-provider.ts), [`../../../packages/mail-gmail/src/gmail-provider.test.ts`](../../../packages/mail-gmail/src/gmail-provider.test.ts), commit [`43abd3074a595ce9cac76a7f95b61c2b737597f1`](https://github.com/GambaGlobal/ai-email-project/commit/43abd3074a595ce9cac76a7f95b61c2b737597f1).

5. **12.5** Goal: deterministic Gmail state label operations + reason-code mapping.  
Acceptance: label ensure/reuse, state label set semantics, success and missing-recipient mapping.  
Evidence: [`../../../packages/shared/src/mail/provider.ts`](../../../packages/shared/src/mail/provider.ts), [`../../../packages/mail-gmail/src/gmail-provider.ts`](../../../packages/mail-gmail/src/gmail-provider.ts), [`../../../apps/worker/src/mailbox-sync.ts`](../../../apps/worker/src/mailbox-sync.ts), commit [`88f699ed2bebe792e13cee9330cdd07d6942e214`](https://github.com/GambaGlobal/ai-email-project/commit/88f699ed2bebe792e13cee9330cdd07d6942e214).

6. **12.6** Goal: wire runtime queue stages end-to-end.  
Acceptance: real stage processors, deterministic job IDs, env-gated writes/labels, stage tests without Redis dependency.  
Evidence: [`../../../apps/worker/src/pipeline/types.ts`](../../../apps/worker/src/pipeline/types.ts), [`../../../apps/worker/src/pipeline/stages.ts`](../../../apps/worker/src/pipeline/stages.ts), [`../../../apps/worker/src/pipeline/stages.test.ts`](../../../apps/worker/src/pipeline/stages.test.ts), [`../../../apps/worker/src/index.ts`](../../../apps/worker/src/index.ts), commit [`6c312b16ae8a4af8c9d4596c72be7d514356268c`](https://github.com/GambaGlobal/ai-email-project/commit/6c312b16ae8a4af8c9d4596c72be7d514356268c).

7. **12.7** Goal: enforce worker kill switch for writeback/labels.  
Acceptance: global + per-tenant controls, fail-closed behavior, refresh-based enforcement, stage-level no-call guarantees.  
Evidence: [`../../../apps/worker/src/pipeline/kill-switch.ts`](../../../apps/worker/src/pipeline/kill-switch.ts), [`../../../apps/worker/src/pipeline/kill-switch.test.ts`](../../../apps/worker/src/pipeline/kill-switch.test.ts), [`../../../apps/worker/src/pipeline/stages.test.ts`](../../../apps/worker/src/pipeline/stages.test.ts), commit [`cbcfbf8a3ce329aab57e8dc6aadf754303201dc0`](https://github.com/GambaGlobal/ai-email-project/commit/cbcfbf8a3ce329aab57e8dc6aadf754303201dc0).

8. **12.8** Goal: add DLQ sink + safe replay for permanent failures.  
Acceptance: permanent failures sink to DLQ, transients retry, replay re-enqueues deterministic job IDs and increments replay metadata.  
Evidence: [`../../../apps/worker/src/pipeline/errors.ts`](../../../apps/worker/src/pipeline/errors.ts), [`../../../apps/worker/src/pipeline/execution.ts`](../../../apps/worker/src/pipeline/execution.ts), [`../../../apps/worker/src/pipeline/dlq.ts`](../../../apps/worker/src/pipeline/dlq.ts), [`../../../apps/worker/src/pipeline/replay.ts`](../../../apps/worker/src/pipeline/replay.ts), commit [`112a7b017a642cb4729d54906998caa4a7bdb92b`](https://github.com/GambaGlobal/ai-email-project/commit/112a7b017a642cb4729d54906998caa4a7bdb92b).

## E) Next Action Prompt
Phase 12 complete. Which Step ID should we run first for Phase 13?
