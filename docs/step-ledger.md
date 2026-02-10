# Step Ledger

Use `SELF` in the Commit/PR column for the commit that implements the step.

| Step ID | Date | Commit/PR | Summary | Notes |
| --- | --- | --- | --- | --- |
| 1.1 | 2026-02-09 | 255ba44 | Add governance artifacts (AGENTS, decisions, ledger). |  |
| 1.6 | 2026-02-09 | SELF | Add local infra compose, env examples, and docs. |  |
| 1.5 | 2026-02-09 | 837b639 | Add GitHub Actions CI checks for repo safety rails. |  |
| 1.6.1 | 2026-02-09 | SELF | Standardize ledger commit value for self-implementing steps. |  |
| 1.7 | 2026-02-09 | SELF | Scaffold core packages (core/mail/telemetry/db). |  |
| 1.8 | 2026-02-09 | SELF | DB migrations scaffold added. |  |
| 1.9 | 2026-02-10 | SELF | API and worker smoke boot with healthz. |  |
| 2.1 | 2026-02-10 | SELF | Added/updated DR-0001 tech stack and added DR-0003 Phase 2 architecture lock. |  |
| 2.2 | 2026-02-10 | SELF | Added architecture overview doc defining boundaries and event pipeline. |  |
| 2.3 | 2026-02-10 | SELF | Defined canonical contracts for MailProvider, event pipeline, AI boundary, and auditability. |  |
| 2.4 | 2026-02-10 | SELF | Added minimal data model spec for Phase 2. |  |
| 2.5 | 2026-02-10 | SELF | Added initial Postgres migrations for minimal multi-tenant schema. |  |
| 2.6 | 2026-02-10 | SELF | Added Postgres RLS tenant isolation policies + verification script. |  |
| 2.7 | 2026-02-10 | SELF | Added canonical mail models and MailProvider interface in shared package. |  |
| 2.8 | 2026-02-10 | SELF | Added GmailProvider adapter scaffold implementing MailProvider (stubbed). |  |
| 2.8.1 | 2026-02-10 | SELF | Added mail-gmail README with construction examples. |  |
| 2.9 | 2026-02-10 | SELF | Added runtime mail provider registry composition root (gmail wired, outlook placeholder). |  |
| 2.10 | 2026-02-10 | SELF | Added shared pipeline job + run + audit contract types. |  |
| 2.11 | 2026-02-10 | SELF | Added shared queue naming + retry defaults + envelope helper. |  |
| 2.12 | 2026-02-10 | SELF | Phase 2 closeout doc with decisions, evidence gate, milestone map, and next backlog. |  |
| 6.1 | 2026-02-10 | SELF | Define provider-agnostic MailProvider Thread+Draft contract (types/interfaces only). |  |
| 6.2 | 2026-02-10 | SELF | Define Copilot label namespace + thread state mapping constants. |  |
| 6.2.1 | 2026-02-10 | SELF | Patch Copilot label set to include Ready and align state mapping. |  |
| 6.3 | 2026-02-10 | SELF | Define v1 eligibility + sensitive triage rules as shared pure helpers. |  |
