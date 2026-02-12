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
| 2.1 | 2026-02-10 | SELF | Added/updated DR-0001 tech stack and added DR-0007 Phase 2 architecture lock. |  |
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
| 6.3.1 | 2026-02-10 | SELF | Fix triage reason taxonomy for user-draft presence (needs_review reason). |  |
| 6.4 | 2026-02-10 | SELF | Define cursor-based ingestion contract + canonical system label normalization rule. |  |
| 6.5 | 2026-02-10 | SELF | Define Copilot draft marker + fingerprint helpers to prevent overwriting human edits. |  |
| 6.6 | 2026-02-10 | SELF | Define thread-scoped concurrency + ordering + idempotency contract. |  |
| 6.7 | 2026-02-10 | SELF | Define v1 draft lifecycle state machine planner (shared) + contract doc. |  |
| 6.8 | 2026-02-10 | SELF | Define failure taxonomy + retry/resync contract helpers. |  |
| 6.9 | 2026-02-10 | SELF | Define telemetry event schema + Phase 6 evidence metrics. |  |
| 6.10 | 2026-02-10 | SELF | Phase 6 closeout: DR + evidence gate + Phase 7 milestone/backlog. |  |
| 7.2 | 2026-02-10 | SELF | Phase 7: knowledge taxonomy + doc priority + metadata/staleness spec. |  |
| 7.3 | 2026-02-10 | SELF | Phase 7: ingestion pipeline spec (upload→parse→chunk→embed→index) + idempotency/failure states. |  |
| 7.4 | 2026-02-10 | SELF | Phase 7: chunking + operator-visible citation scheme spec. |  |
| 7.5 | 2026-02-10 | SELF | Phase 7: retrieval & ranking spec (hybrid search, precedence, staleness, evidence packs). |  |
| 7.6 | 2026-02-10 | SELF | Phase 7: conflict + staleness handling spec (deterministic escalation + reason codes). |  |
| 7.7 | 2026-02-10 | SELF | Phase 7: unknown rules + evaluation plan (grounding metrics + evidence gate). |  |
| 7.1 | 2026-02-10 | SELF | Phase 7 closeout: DR-0005 + evidence gate + Phase 8 milestones/backlog. |  |
| 8.1 | 2026-02-10 | SELF | Added Phase 8 guardrails Decision Record (matrix + forbidden list). |  |
| 8.1.1 | 2026-02-10 | SELF | Renumbered Phase 2 architecture lock DR to resolve duplicate 0003 numbering. |  |
| 8.2 | 2026-02-10 | SELF | Added Phase 8 guardrail taxonomy examples bank (v1). |  |
| 8.3 | 2026-02-10 | SELF | Added Phase 8 classification policy spec (rules → AI → policy engine). |  |
| 8.4 | 2026-02-10 | SELF | Added Phase 8 audit logging + privacy spec (v1). |  |
| 8.5 | 2026-02-10 | SELF | Added Phase 8 operator review UX spec (Gmail-first). |  |
| 8.6 | 2026-02-10 | SELF | Added Phase 8 golden dataset + evaluation plan (v1). |  |
| 8.7 | 2026-02-10 | SELF | Added Phase 8 tenant customization boundaries spec (v1). |  |
| 9.1 | 2026-02-12 | SELF | Added Phase 9 Decision Record for operator setup + minimal admin UX. |  |
| 9.2 | 2026-02-12 | SELF | Scaffolded admin IA routes + page stubs for onboarding, docs, tone/policies, and health (Phase 9). |  |
| 9.3 | 2026-02-12 | SELF | Added onboarding wizard shell with stepper + local persistence (Phase 9). |  |
| 9.3.1 | 2026-02-12 | SELF | Aligned onboarding wizard steps to 5-step Phase 9 flow (Profile, Gmail, Docs, Defaults, Enable Drafts). |  |
| 9.4 | 2026-02-12 | SELF | Added mocked Gmail connection UX states + test connection UI in onboarding. |  |
| 9.6 | 2026-02-12 | SELF | Added mocked docs upload + categorization UI with status chips and local persistence. |  |
| 9.8 | 2026-02-12 | SELF | Added mocked tone + escalation policies UI with local persistence and preview. |  |
| 9.10 | 2026-02-12 | SELF | Added Enable Drafts gating step based on Gmail connection + indexed docs, with local persistence. |  |
