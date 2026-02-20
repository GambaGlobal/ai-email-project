# Phase 11 — Security, Privacy & Data Retention (Closeout)

## Date
2026-02-15

## Decision Record
- `docs/decisions/0012-phase-11-security-privacy-data-retention.md`

## Summary (What Changed)

- Established a Phase 11 trust baseline with minimization by default and clear disclosure posture.
- Locked human-in-control operations: v1 drafts are never auto-sent and sensitive topics are flagged for review.
- Published a data map and classification taxonomy covering customer content, PII, derived data, and operational telemetry.
- Defined tenant isolation requirements across DB, storage, queues, admin access, and provider boundaries.
- Defined token and secrets posture for OAuth lifecycle, encryption-at-rest model, revocation/disconnect, and auditability.
- Published default retention windows and deletion workflows (doc delete, mailbox disconnect, tenant deletion request).
- Added a plain-language security/privacy FAQ for operator and procurement conversations.
- Added a two-part lite questionnaire pack for security and privacy review intake responses.
- Froze Phase 11 trust decisions in DR-0012 as the canonical policy layer for sales and engineering.

## Evidence Gate

Criteria and evidence that Phase 11 is complete:

- Published Data Map: satisfied by `docs/phases/phase-11-security/data-map-classification-v1.md` (11.1).
- Tenant Isolation Spec: satisfied by `docs/phases/phase-11-security/tenant-isolation-requirements-v1.md` (11.2).
- Token Handling Spec: satisfied by `docs/phases/phase-11-security/token-storage-secrets-posture-v1.md` (11.3).
- Retention/Deletion Policy: satisfied by `docs/phases/phase-11-security/retention-deletion-policy-v1.md` (11.4).
- Prospect FAQ: satisfied by `docs/phases/phase-11-security/security-privacy-faq-v1.md` (11.5).
- Questionnaire Pack: satisfied by `docs/phases/phase-11-security/questionnaire-pack-lite-v1.md` (11.6).
- Decision Record Frozen: satisfied by `docs/decisions/0012-phase-11-security-privacy-data-retention.md` (11.7).

## Milestone Map

1. Data Inventory + Minimization Baseline
- Why it matters: defines what data is and is not stored to reduce exposure risk.
- References: `docs/phases/phase-11-security/data-map-classification-v1.md`

2. Tenant Isolation Boundary Defined
- Why it matters: prevents cross-tenant leakage across DB, storage, queues, and admin surfaces.
- References: `docs/phases/phase-11-security/tenant-isolation-requirements-v1.md`

3. Token/Secrets Posture Defined
- Why it matters: reduces account takeover and credential leakage risk.
- References: `docs/phases/phase-11-security/token-storage-secrets-posture-v1.md`

4. Retention + Deletion Story Finalized
- Why it matters: clarifies retention windows, deletion workflows, and backup implications.
- References: `docs/phases/phase-11-security/retention-deletion-policy-v1.md`

5. Prospect-Ready FAQ Produced
- Why it matters: gives sales/procurement plain-language, no-overpromise answers.
- References: `docs/phases/phase-11-security/security-privacy-faq-v1.md`

6. Questionnaire Pack Ready for Procurement
- Why it matters: accelerates security/privacy review cycles with evidence-linked responses.
- References: `docs/phases/phase-11-security/questionnaire-pack-lite-v1.md`

## Step Backlog Status

Completed:
- 11.1 `cfe8d95`
- 11.2 `1452019`
- 11.3 `c5c12b4`
- 11.4 `0c188fd`
- 11.5 `ff7bcd5`
- 11.6 `038be9d`
- 11.7 `af4ba6d`
- 11.8 `SELF` (this step)

Deferred / Next (brief):
- Formal incident response runbook depth and response workflow hardening.
- SOC2/ISO roadmap DR (if pursued).
- Data residency DR for regional hosting options.
- CMK/BYOK DR and implementation scope.

## Risks / Open Questions

- No SOC2/ISO certification is claimed in current v1 posture docs.
- Optional debug retention remains off-by-default and implementation is TBD.
- Regional hosting/data residency options are TBD beyond current US-hosted v1 posture.
- Implementation validation is still needed in build phases for controls such as strict tenant filters, RLS enforcement before GA, and operational deletion/retention jobs.

## What's Next (Recommendations)

1. Option A: Phase 12 Reliability & Observability (Build)
- Implement and verify control-level observability/validation gates tied to trust posture.

2. Option B: Phase 12 Trust Implementation
- Implement DB/RLS enforcement hardening, token encryption flows, retention/deletion jobs, and tenant deletion workflows to match Phase 11 policy docs.
