# Phase 11.6 - Lite Security Questionnaire Pack (v1)

## How To Use This Pack

This pack is a pre-filled, plain-English response set for early security and privacy reviews.

- Scope: v1 posture only.
- Source of truth: Phase 11 docs (11.1 to 11.5).
- Status tags:
- `[Yes]` = implemented posture in current docs.
- `[Partial]` = partially implemented or scoped with limitations.
- `[No]` = not supported.
- `[Not yet]` = planned/future posture, not available now.

Use this pack as a starting point, then tailor wording for each prospect questionnaire.

## Questionnaire 1: Vendor Security Overview (Lite)

| # | Question | Answer | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | What does the product do? | Gmail-first AI copilot that reads incoming guest emails and generates draft replies for operators. | [Yes] | [`security-privacy-faq-v1.md#1-what-does-the-product-do`](./security-privacy-faq-v1.md#1-what-does-the-product-do) |
| 2 | Does the system auto-send emails? | No. v1 drafts are never auto-sent; operator review is required. | [Yes] | [`security-privacy-faq-v1.md#2-does-it-ever-send-emails-automatically`](./security-privacy-faq-v1.md#2-does-it-ever-send-emails-automatically) |
| 3 | Is there a human approval checkpoint? | Yes. Sensitive or uncertain cases are flagged for human review before any send action by operator. | [Yes] | [`security-privacy-faq-v1.md#j-human-review--sensitive-topics`](./security-privacy-faq-v1.md#j-human-review--sensitive-topics) |
| 4 | Is customer access tenant-scoped? | Yes. Tenant boundary is a core invariant for all tenant-scoped resources. | [Yes] | [`tenant-isolation-requirements-v1.md#c-isolation-model-frozen-requirements`](./tenant-isolation-requirements-v1.md#c-isolation-model-frozen-requirements) |
| 5 | Is DB isolation enforced at schema/query level? | Required posture: tenant_id scoping on tenant tables, tenant-scoped queries, and RLS before GA. | [Partial] | [`tenant-isolation-requirements-v1.md#d-db-requirements-postgres--pgvector`](./tenant-isolation-requirements-v1.md#d-db-requirements-postgres--pgvector) |
| 6 | Is row-level security used? | RLS is a required control in the model and must be enforced before GA. | [Partial] | [`tenant-isolation-requirements-v1.md#c-isolation-model-frozen-requirements`](./tenant-isolation-requirements-v1.md#c-isolation-model-frozen-requirements) |
| 7 | Is object storage tenant-separated? | Yes, required via per-tenant prefixes in S3-compatible storage paths. | [Yes] | [`tenant-isolation-requirements-v1.md#e-storage-requirements-s3-compatible-docs`](./tenant-isolation-requirements-v1.md#e-storage-requirements-s3-compatible-docs) |
| 8 | Are queue jobs tenant-scoped? | Yes, each job must include tenant context and workers must resolve records via tenant-scoped lookups. | [Yes] | [`tenant-isolation-requirements-v1.md#f-queue--job-payload-requirements-bullmq--redis`](./tenant-isolation-requirements-v1.md#f-queue--job-payload-requirements-bullmq--redis) |
| 9 | Are admin views tenant-scoped? | Yes, admin UI is tenant-scoped by default; privileged paths must be explicit and audited. | [Yes] | [`tenant-isolation-requirements-v1.md#h-adminonboarding-access-boundaries-nextjs-admin`](./tenant-isolation-requirements-v1.md#h-adminonboarding-access-boundaries-nextjs-admin) |
| 10 | Can admins view OAuth tokens? | No. Admin UI shows connection status; token values are not exposed. | [Yes] | [`token-storage-secrets-posture-v1.md#e-access-controls--service-boundaries`](./token-storage-secrets-posture-v1.md#e-access-controls--service-boundaries) |
| 11 | Are refresh tokens encrypted at rest? | Yes. Required posture is encrypted storage with envelope encryption model. | [Yes] | [`token-storage-secrets-posture-v1.md#d-storage-posture-conceptual-frozen-requirements`](./token-storage-secrets-posture-v1.md#d-storage-posture-conceptual-frozen-requirements) |
| 12 | Are access tokens long-term persisted? | No by default. Access tokens should be short-lived and non-persistent. | [Yes] | [`token-storage-secrets-posture-v1.md#d-storage-posture-conceptual-frozen-requirements`](./token-storage-secrets-posture-v1.md#d-storage-posture-conceptual-frozen-requirements) |
| 13 | Do you have token revoke/disconnect handling? | Yes. Disconnect includes revoke attempt, local disable, and token material deletion. | [Yes] | [`token-storage-secrets-posture-v1.md#f-rotation-revocation-and-disconnect-behavior`](./token-storage-secrets-posture-v1.md#f-rotation-revocation-and-disconnect-behavior) |
| 14 | Do you support key rotation posture for encrypted secrets? | Yes. Re-encryption with key version (`kid`) is required posture. | [Yes] | [`token-storage-secrets-posture-v1.md#f-rotation-revocation-and-disconnect-behavior`](./token-storage-secrets-posture-v1.md#f-rotation-revocation-and-disconnect-behavior) |
| 15 | Is encryption guaranteed with a named cipher suite? | No explicit algorithm claim is made in current docs. Encryption posture is stated conceptually. | [Partial] | [`token-storage-secrets-posture-v1.md#d-storage-posture-conceptual-frozen-requirements`](./token-storage-secrets-posture-v1.md#d-storage-posture-conceptual-frozen-requirements) |
| 16 | Do logs include sensitive payloads? | No. Raw email bodies, attachments, tokens, secrets are in the never-log list. | [Yes] | [`data-map-classification-v1.md#f-redaction--logging-rules`](./data-map-classification-v1.md#f-redaction--logging-rules), [`token-storage-secrets-posture-v1.md#g-logging-redaction-and-incident-safety`](./token-storage-secrets-posture-v1.md#g-logging-redaction-and-incident-safety) |
| 17 | Is there security-relevant audit logging? | Yes. Security-related token, mailbox, and role change events are required. | [Yes] | [`tenant-isolation-requirements-v1.md#j-audit-requirements-docs-only`](./tenant-isolation-requirements-v1.md#j-audit-requirements-docs-only), [`token-storage-secrets-posture-v1.md#i-audit-events-required`](./token-storage-secrets-posture-v1.md#i-audit-events-required) |
| 18 | Do you monitor token/security reliability signals? | Yes, posture includes token refresh success/failure and reconnect metrics. | [Yes] | [`token-storage-secrets-posture-v1.md#g-logging-redaction-and-incident-safety`](./token-storage-secrets-posture-v1.md#g-logging-redaction-and-incident-safety), [`security-privacy-faq-v1.md#23-how-do-you-monitor-the-system-for-security-issues`](./security-privacy-faq-v1.md#23-how-do-you-monitor-the-system-for-security-issues) |
| 19 | Do you have incident response behavior defined? | Yes at high level: containment, credential rotation/revocation, investigation, reconnect steps. | [Partial] | [`security-privacy-faq-v1.md#24-what-happens-if-theres-an-incident`](./security-privacy-faq-v1.md#24-what-happens-if-theres-an-incident) |
| 20 | Is there a vulnerability disclosure contact path? | Yes. Report via support/security contact defined in customer agreement. | [Yes] | [`security-privacy-faq-v1.md#25-do-you-have-a-vulnerability-disclosure-process`](./security-privacy-faq-v1.md#25-do-you-have-a-vulnerability-disclosure-process) |
| 21 | Are SOC 2 or ISO certifications claimed? | No. Current v1 docs explicitly do not claim SOC 2 or ISO certification. | [No] | [`security-privacy-faq-v1.md#26-are-you-soc-2--iso-certified`](./security-privacy-faq-v1.md#26-are-you-soc-2--iso-certified) |
| 22 | Do you use third-party providers/subprocessors? | Yes, at high level: cloud infrastructure, Gmail/Google services, and OpenAI for draft generation workflows. | [Yes] | [`data-map-classification-v1.md#a-purpose--scope`](./data-map-classification-v1.md#a-purpose--scope), [`security-privacy-faq-v1.md#d-how-ai-processing-works-openai`](./security-privacy-faq-v1.md#d-how-ai-processing-works-openai) |
| 23 | Do backups exist and have a retention window? | Yes. Backup retention is defined as 35 days with encrypted, access-limited posture. | [Yes] | [`retention-deletion-policy-v1.md#e-backups-and-disaster-recovery-disclosure`](./retention-deletion-policy-v1.md#e-backups-and-disaster-recovery-disclosure), [`retention-deletion-policy-v1.md#c-default-retention-table`](./retention-deletion-policy-v1.md#c-default-retention-table) |
| 24 | Is business continuity/disaster recovery fully documented? | Basic backup/restore posture is documented; detailed formal BC/DR playbooks are future-hardening work. | [Partial] | [`retention-deletion-policy-v1.md#e-backups-and-disaster-recovery-disclosure`](./retention-deletion-policy-v1.md#e-backups-and-disaster-recovery-disclosure) |
| 25 | Is customer-managed key (CMK/BYOK) supported now? | Not yet. Listed as future follow-up consideration. | [Not yet] | [`token-storage-secrets-posture-v1.md#j-open-questions--follow-ups`](./token-storage-secrets-posture-v1.md#j-open-questions--follow-ups) |

## Questionnaire 2: Privacy + Data Handling (Lite)

| # | Question | Answer | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | What categories of data are processed? | Guest communication context, operator knowledge docs, derived retrieval artifacts, and operational metadata. | [Yes] | [`data-map-classification-v1.md#c-data-classification-taxonomy`](./data-map-classification-v1.md#c-data-classification-taxonomy) |
| 2 | Can guest PII appear in processed data? | Yes, guest PII may appear in emails and related metadata. | [Yes] | [`data-map-classification-v1.md#c-data-classification-taxonomy`](./data-map-classification-v1.md#c-data-classification-taxonomy) |
| 3 | Do you store raw guest email bodies by default? | No. Raw bodies are not persisted by default. | [Yes] | [`data-map-classification-v1.md#b-data-principles-minimization-first`](./data-map-classification-v1.md#b-data-principles-minimization-first), [`security-privacy-faq-v1.md#5-do-you-store-the-content-of-guest-emails`](./security-privacy-faq-v1.md#5-do-you-store-the-content-of-guest-emails) |
| 4 | Do you store attachments by default? | No. Attachments are not persisted by default. | [Yes] | [`data-map-classification-v1.md#b-data-principles-minimization-first`](./data-map-classification-v1.md#b-data-principles-minimization-first), [`security-privacy-faq-v1.md#6-do-you-store-attachments`](./security-privacy-faq-v1.md#6-do-you-store-attachments) |
| 5 | What business content is stored? | Operator-uploaded docs plus derived chunks/embeddings are stored for grounding and retrieval. | [Yes] | [`data-map-classification-v1.md#b-data-principles-minimization-first`](./data-map-classification-v1.md#b-data-principles-minimization-first), [`retention-deletion-policy-v1.md#c-default-retention-table`](./retention-deletion-policy-v1.md#c-default-retention-table) |
| 6 | Do you store generated draft outputs? | Yes. Draft text, status, and citations are retained for defined periods. | [Yes] | [`data-map-classification-v1.md#d-data-objects-inventory`](./data-map-classification-v1.md#d-data-objects-inventory), [`retention-deletion-policy-v1.md#c-default-retention-table`](./retention-deletion-policy-v1.md#c-default-retention-table) |
| 7 | Do you store full message bodies in logs? | No. Full content and secrets are prohibited from logs. | [Yes] | [`data-map-classification-v1.md#f-redaction--logging-rules`](./data-map-classification-v1.md#f-redaction--logging-rules) |
| 8 | Are prompts/responses stored in full? | Stored artifacts are minimized to draft/citation records and operationally needed metadata; not full raw message body persistence by default. | [Partial] | [`security-privacy-faq-v1.md#9-do-you-store-ai-promptsresponses`](./security-privacy-faq-v1.md#9-do-you-store-ai-promptsresponses), [`data-map-classification-v1.md#b-data-principles-minimization-first`](./data-map-classification-v1.md#b-data-principles-minimization-first) |
| 9 | What is sent to the AI model? | Minimal required email context and relevant document snippets, plus policy/tone instructions. | [Yes] | [`data-map-classification-v1.md#e-what-we-send-to-openai-processing-disclosure`](./data-map-classification-v1.md#e-what-we-send-to-openai-processing-disclosure) |
| 10 | Is the full document library sent on each request? | No. Only relevant snippets are sent. | [Yes] | [`data-map-classification-v1.md#e-what-we-send-to-openai-processing-disclosure`](./data-map-classification-v1.md#e-what-we-send-to-openai-processing-disclosure), [`security-privacy-faq-v1.md#11-do-you-send-my-entire-document-library-to-the-ai-each-time`](./security-privacy-faq-v1.md#11-do-you-send-my-entire-document-library-to-the-ai-each-time) |
| 11 | Do you claim model-training guarantees beyond provider terms? | No. The policy references minimization and provider-governed terms; no extra guarantee is claimed here. | [Partial] | [`security-privacy-faq-v1.md#12-do-you-train-ai-models-on-our-data`](./security-privacy-faq-v1.md#12-do-you-train-ai-models-on-our-data) |
| 12 | What is default retention for draft records? | 180 days. | [Yes] | [`retention-deletion-policy-v1.md#c-default-retention-table`](./retention-deletion-policy-v1.md#c-default-retention-table) |
| 13 | What is default retention for message/thread metadata? | 180 days. | [Yes] | [`retention-deletion-policy-v1.md#c-default-retention-table`](./retention-deletion-policy-v1.md#c-default-retention-table) |
| 14 | What is default retention for audit events? | 1 year. | [Yes] | [`retention-deletion-policy-v1.md#c-default-retention-table`](./retention-deletion-policy-v1.md#c-default-retention-table) |
| 15 | What is default retention for logs? | 30 days for PII-redacted logs. | [Yes] | [`retention-deletion-policy-v1.md#c-default-retention-table`](./retention-deletion-policy-v1.md#c-default-retention-table) |
| 16 | What is default retention for metrics? | 13 months for non-PII aggregates. | [Yes] | [`retention-deletion-policy-v1.md#c-default-retention-table`](./retention-deletion-policy-v1.md#c-default-retention-table) |
| 17 | What is backup retention? | 35 days; deleted primary data may remain in backups until expiry. | [Yes] | [`retention-deletion-policy-v1.md#e-backups-and-disaster-recovery-disclosure`](./retention-deletion-policy-v1.md#e-backups-and-disaster-recovery-disclosure) |
| 18 | Is there a documented doc-delete workflow? | Yes. Includes source-object delete, derived-artifact delete, audit event, and 24-hour target completion. | [Yes] | [`retention-deletion-policy-v1.md#1-operator-deletes-a-knowledge-doc`](./retention-deletion-policy-v1.md#1-operator-deletes-a-knowledge-doc) |
| 19 | Is there a documented mailbox-disconnect workflow? | Yes. Revoke attempt, local token deletion, disable connection, and controlled retention of non-token history. | [Yes] | [`retention-deletion-policy-v1.md#2-mailbox-disconnect-operator-revokes-accessdisconnects`](./retention-deletion-policy-v1.md#2-mailbox-disconnect-operator-revokes-accessdisconnects), [`token-storage-secrets-posture-v1.md#f-rotation-revocation-and-disconnect-behavior`](./token-storage-secrets-posture-v1.md#f-rotation-revocation-and-disconnect-behavior) |
| 20 | Is there a tenant deletion workflow and SLA? | Yes. Primary-system purge target is within 7 days; backup age-out window is 35 days. | [Yes] | [`retention-deletion-policy-v1.md#3-tenant-deletion-request-right-to-delete`](./retention-deletion-policy-v1.md#3-tenant-deletion-request-right-to-delete) |
| 21 | Is data residency multi-region configurable in v1? | Not yet. v1 is US-hosted; regional options are planned. | [Not yet] | [`security-privacy-faq-v1.md#28-where-is-data-hosted--data-residency`](./security-privacy-faq-v1.md#28-where-is-data-hosted--data-residency) |
| 22 | Do you claim GDPR/CCPA certification or full legal compliance in this pack? | No. No certification/legal compliance claim is made here; posture emphasizes minimization and deletion support. | [No] | [`security-privacy-faq-v1.md#i-compliance--legal`](./security-privacy-faq-v1.md#i-compliance--legal), [`retention-deletion-policy-v1.md#b-guiding-principles`](./retention-deletion-policy-v1.md#b-guiding-principles) |
| 23 | Is DPA handling defined? | DPA/legal terms are handled through commercial/legal agreement workflows. | [Partial] | [`security-privacy-faq-v1.md#27-do-you-sign-dpas`](./security-privacy-faq-v1.md#27-do-you-sign-dpas) |
| 24 | Is optional debug retention available now? | Not yet. It is planned and off by default in v1. | [Not yet] | [`retention-deletion-policy-v1.md#f-optional-debug-retention-window-off-by-default`](./retention-deletion-policy-v1.md#f-optional-debug-retention-window-off-by-default) |
| 25 | Is the product designed for collecting children's data? | No specific child-data feature is defined; product is not designed to collect children’s data and operators control inbox content. | [Partial] | [`security-privacy-faq-v1.md#a-product-basics--control`](./security-privacy-faq-v1.md#a-product-basics--control), [`data-map-classification-v1.md#a-purpose--scope`](./data-map-classification-v1.md#a-purpose--scope) |

## Known Gaps / Not Yet Implemented

- Formal SOC 2 / ISO certification is not claimed in v1 docs.
- Regional hosting/data residency options are not available in v1.
- Optional debug retention feature is planned, not available in v1.
- Customer-managed keys (CMK/BYOK) are a future consideration.
- Detailed formal BC/DR and incident program maturity docs can be expanded in later phases.

Evidence:
- [`security-privacy-faq-v1.md#26-are-you-soc-2--iso-certified`](./security-privacy-faq-v1.md#26-are-you-soc-2--iso-certified)
- [`security-privacy-faq-v1.md#28-where-is-data-hosted--data-residency`](./security-privacy-faq-v1.md#28-where-is-data-hosted--data-residency)
- [`retention-deletion-policy-v1.md#f-optional-debug-retention-window-off-by-default`](./retention-deletion-policy-v1.md#f-optional-debug-retention-window-off-by-default)
- [`token-storage-secrets-posture-v1.md#j-open-questions--follow-ups`](./token-storage-secrets-posture-v1.md#j-open-questions--follow-ups)

## Planned Next Steps (Roadmap, Not Commitments)

- Formalize incident response runbook depth and response workflows.
- Evaluate security certification roadmap (for example SOC 2 readiness path).
- Finalize KMS/secret-manager implementation details and key governance hardening.
- Evaluate enterprise key management options (CMK/BYOK).
- Evaluate regional hosting options beyond US for future versions.
