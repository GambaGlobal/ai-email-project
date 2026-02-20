# DR-0013: Phase 12 — Rebaseline + Product Engine Completion

## Status
Accepted

## Date
2026-02-15

## Owners
Product + Eng

## Context / Problem
- We need to remove drift between documentation and implemented reality.
- Current phase naming/status is fragmented across multiple docs and closeouts.
- Phase 12 is the product-engine completion phase and must focus on reliable drafts, exactly-once behavior, and safe operational fallbacks.

## Decisions
1. `docs/phases.md` is the single source of truth for phase naming and phase status.
2. Phase 12 scope is locked to product engine completion:
   - queued pipeline completion
   - exactly-once boundaries
   - dead-letter queue and replay operations
   - operator kill switches and safe fallbacks
3. Baseline statements must be evidence-backed with:
   - repository file links
   - commit hash
   - GitHub commit URL when remote is GitHub

## Tradeoffs
- We prioritize correctness, trust, and debuggability over implementation speed.
- We accept ongoing documentation upkeep overhead to prevent roadmap/reality drift.

## What's Real Today (Evidence Baseline)
Derived from `docs/step-ledger.md`, `git log -n 20 --oneline`, and existing phase closeouts/DRs.

- Capability: repository governance + stack lock docs exist and are tracked.
  - Files: [`../../AGENTS.md`](../../AGENTS.md), [`0001-tech-stack.md`](0001-tech-stack.md), [`../step-ledger.md`](../step-ledger.md)
  - Commit: `255ba4483a9cb2d37927d16f62f1a786762cb44a` ([link](https://github.com/GambaGlobal/ai-email-project/commit/255ba4483a9cb2d37927d16f62f1a786762cb44a))
- Capability: API process boots and serves health endpoint (`/healthz`).
  - File: [`../../apps/api/src/index.ts`](../../apps/api/src/index.ts)
  - Commit: `69c24a81a15fd0408246cde9f12b0022ce1d6bc9` ([link](https://github.com/GambaGlobal/ai-email-project/commit/69c24a81a15fd0408246cde9f12b0022ce1d6bc9))
- Capability: worker process runs queue consumers with kill-switch-aware reliability controls.
  - Files: [`../../apps/worker/src/index.ts`](../../apps/worker/src/index.ts), [`../../packages/shared/src/reliability/kill-switches.ts`](../../packages/shared/src/reliability/kill-switches.ts)
  - Commit: `41a5e57177e16977fd269d0252c7a781329afdfc` ([link](https://github.com/GambaGlobal/ai-email-project/commit/41a5e57177e16977fd269d0252c7a781329afdfc))
- Capability: shared queue contracts/retry defaults exist in shared package.
  - File: [`../../packages/shared/src/queue/types.ts`](../../packages/shared/src/queue/types.ts)
  - Commit: `29e93296dacc44319c9ec8a085601eae3325c23d` ([link](https://github.com/GambaGlobal/ai-email-project/commit/29e93296dacc44319c9ec8a085601eae3325c23d))
- Capability: Gmail notification and mailbox sync reliability boundaries are implemented (dedupe, coalescing, precision, kill-switch enforcement).
  - Files: [`../../apps/api/src/routes/gmail-notifications.ts`](../../apps/api/src/routes/gmail-notifications.ts), [`../../apps/api/src/lib/mailbox-sync-queue.ts`](../../apps/api/src/lib/mailbox-sync-queue.ts), [`../../packages/db/migrations/010_mail_notification_receipts.js`](../../packages/db/migrations/010_mail_notification_receipts.js), [`../../packages/db/migrations/012_mailbox_sync_state.js`](../../packages/db/migrations/012_mailbox_sync_state.js), [`../../packages/db/migrations/013_mailbox_sync_state_invariants.js`](../../packages/db/migrations/013_mailbox_sync_state_invariants.js)
  - Commits:
    - `0a32bb7d72d27625145db98138b8e440dad35d4d` ([link](https://github.com/GambaGlobal/ai-email-project/commit/0a32bb7d72d27625145db98138b8e440dad35d4d))
    - `3c709f78cd5595894e6ae401801d10d3a9c8e332` ([link](https://github.com/GambaGlobal/ai-email-project/commit/3c709f78cd5595894e6ae401801d10d3a9c8e332))
    - `41a5e57177e16977fd269d0252c7a781329afdfc` ([link](https://github.com/GambaGlobal/ai-email-project/commit/41a5e57177e16977fd269d0252c7a781329afdfc))
- Capability: Phase 10 and Phase 11 closeouts are present and documented.
  - Files: [`../phases/phase-10-reliability-observability/phase-10-closeout-v1.md`](../phases/phase-10-reliability-observability/phase-10-closeout-v1.md), [`../phases/phase-11-security/phase-11-closeout.md`](../phases/phase-11-security/phase-11-closeout.md)
  - Commits:
    - `18b17fae9419ecbb789cc8cbc9dbe6d48236efc8` ([link](https://github.com/GambaGlobal/ai-email-project/commit/18b17fae9419ecbb789cc8cbc9dbe6d48236efc8))
    - `410daef9211b752ec6769455d722b5514e98aa36` ([link](https://github.com/GambaGlobal/ai-email-project/commit/410daef9211b752ec6769455d722b5514e98aa36))

## Out of Scope
- Any Phase 12 implementation code changes.
- Any stack amendment outside existing decision process.

## References
- [`0001-tech-stack.md`](0001-tech-stack.md)
- [`../phases.md`](../phases.md)
- [`../step-ledger.md`](../step-ledger.md)
