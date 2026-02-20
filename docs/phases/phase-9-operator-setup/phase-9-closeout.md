# Phase 9 Closeout: Operator Setup & Minimal Admin UX

- Phase: 9
- Date: 2026-02-12
- Status: Closed

## 1) Summary (what Phase 9 achieved)
- Added the admin IA scaffold with clickable routes for Onboarding, Docs, Tone & Policies, and System Health.
- Implemented the onboarding wizard spine with 5 aligned steps and local step persistence.
- Added real Gmail OAuth connect/status endpoints and env-gated admin wiring, while preserving mock mode fallback.
- Hardened OAuth flow reliability by moving state storage to Redis with TTL and one-time consume.
- Tightened tenant resolution rules so status APIs require `x-tenant-id` by default, and aligned admin calls to that contract.
- Implemented mocked UX scaffolds for docs and tone/policies, then wired docs to real upload/storage/ingestion in env-gated mode.
- Added server-backed docs list/status/delete/retry flows with admin polling for queued/indexing status updates.
- Preserved onboarding gating compatibility by syncing server docs into localStorage (`operator_docs_v1`).
- Implemented Enable Drafts gating based on Gmail connected + at least one ready doc.
- Implemented System Health with real Gmail/docs signals when env is set, plus explicit placeholder/offline behavior when not set.

## 2) Decision Record(s)
- [DR-0009: Phase 9 — Operator Setup & Minimal Admin UX (v1)](../../decisions/0009-phase-9-operator-setup-min-admin-ux.md)

Practical amendments applied during implementation (without new DR in this step):
- OAuth state hardening to Redis TTL + one-time consume (pilot reliability requirement).
- Tenant resolution tightening to header-first (`x-tenant-id`) for status APIs, with controlled fallback behavior.

## 3) Success Metrics + Evidence Gate
Phase 9 is considered complete when all checks below are true.

### Operator-level functional checks
- Gmail OAuth connect works and admin reflects `connected` / `disconnected` / `reconnect_required` states.
- Docs can be uploaded via admin, and status lifecycle visibility exists for `queued` / `indexing` / `ready` / `failed`.
- Failed docs can be retried; docs can be deleted from admin.
- Onboarding Enable Drafts control is blocked until Gmail is connected and at least one doc is `ready`.
- System Health shows real Gmail + docs signals when env is configured and clearly shows offline/demo mode when env is missing.

### Reliability/trust checks
- OAuth state storage is Redis-backed with TTL and one-time consume; no in-memory-only reliance remains.
- Tenant-sensitive status endpoints require `x-tenant-id` by default; query fallback is disabled by default.

### Engineering checks
- `pnpm -w repo:check` passes for Phase 9 implementation steps.
- Step ledger contains Phase 9 entries for all required Step IDs.

## 4) Milestone Map
- M9.1 Admin shell + routes in place.
  Why it matters: establishes navigable IA and reviewable UX skeleton.
- M9.2 Onboarding wizard spine + persistence.
  Why it matters: creates the operator setup flow contract and preserves progress across refresh.
- M9.3 Real Gmail connect/status + admin wiring.
  Why it matters: replaces mock trust surface with real provider connectivity signals.
- M9.4 Real docs upload + ingestion + status visibility.
  Why it matters: makes knowledge readiness observable and actionable in operator workflows.
- M9.5 Enable Drafts gating contract enforced.
  Why it matters: prevents unsafe activation before prerequisites are satisfied.
- M9.6 System Health trust surface.
  Why it matters: gives operators a single answer to “is it working?” with clear diagnostics.

## 5) Step Backlog Status
### Completed in Phase 9
- 9.1: Added Phase 9 Decision Record and froze v1 admin/onboarding scope.
- 9.2: Scaffolded admin routes and page stubs for core setup surfaces.
- 9.3: Added onboarding wizard shell with stepper and local persistence.
- 9.3.1: Aligned onboarding to full 5-step DR flow.
- 9.4: Added mocked Gmail connection/test UX states.
- 9.5: Implemented real Gmail OAuth start/callback/status endpoints and env-gated admin wiring.
- 9.5.1: Hardened OAuth state storage (Redis TTL + one-time consume) and tightened tenant resolution.
- 9.5.2: Fixed admin status calls to send `x-tenant-id`.
- 9.6: Added mocked docs manager with upload/category/status/retry/remove and local persistence.
- 9.7: Implemented real docs upload to S3 + ingestion trigger + status APIs and admin real-mode wiring.
- 9.8: Added mocked tone + escalation policies manager with local persistence and preview.
- 9.9: Implemented System Health dashboard with real Gmail/docs signals and explicit placeholders.
- 9.10: Added Enable Drafts gating with prerequisite checks and persistence.
- 9.11: Closed out Phase 9 with evidence gate, milestones, backlog status, and next-focus options.

### Deferred / follow-ups (not done in Phase 9)
- Notification health wiring using real Pub/Sub watch telemetry.
- Real tone/policy persistence to DB and API.
- Admin authentication/session and real tenant selection (remove env tenant mechanism).
- Draft-generation pipeline health metrics beyond local enabled/disabled state.
- RBAC, multi-user, multi-mailbox, and billing (explicit v1 exclusions).

## 6) Known Risks / Next Hard Problems
- Replacing env-based tenant identity with authenticated tenant resolution in admin.
- Production handling of OAuth secrets and key rotation procedures.
- S3 permissions, object metadata/content-type correctness, and file validation hardening.
- Ingestion retry behavior and failure backpressure at higher volume.
- Notification monitoring and recovery loops for stale/missed push events.
- Cross-service support tooling and reliable correlation IDs for faster incident triage.
- Tenant-safe observability that remains operator-friendly while preserving privacy boundaries.

## 7) What Phase 10 Should Focus On (proposal only)
- Option A: Notification reliability and watch lifecycle telemetry in System Health.
- Option B: Admin auth/session and tenant identity hardening (remove env tenant dependency).
- Option C: Real tone/policy persistence and retrieval contract in API + DB.
- Option D: Draft pipeline health instrumentation and operator-facing diagnostics.
- Option E: Pilot hardening pass across OAuth/docs ingestion failure recovery paths.

## 8) Final Question
Which Step ID should we run first?
