# Phase 11.5 - Security & Privacy FAQ (v1)

This FAQ is written for operators and procurement reviewers. It explains our current v1 security and privacy posture in plain language.

## A) Product Basics + Control

### 1) What does the product do?
It connects to your Gmail inbox, reads incoming guest emails, and creates draft replies using your business knowledge (for example FAQs, itineraries, and policies).

### 2) Does it ever send emails automatically?
No. In v1, drafts are never auto-sent. A human stays in control and decides whether to edit or send.

### 3) Can we control what the AI is allowed to use?
Yes. You control the business documents and policy guidance used for drafting. Sensitive categories are routed for human review.

## B) What We Access in Gmail

### 4) What Gmail data do you access?
We access the mailbox data needed to detect eligible inbound emails and generate draft replies (for example message/thread context and metadata).

### 5) Do you store the content of guest emails?
By default, we do not persist raw guest email bodies as long-term stored records.

### 6) Do you store attachments?
By default, no. We do not persist raw attachments as part of normal v1 processing.

## C) What We Store (and What We Don't)

### 7) What data do you store about my guests?
We store minimal metadata needed for routing, threading, and review (for example message/thread identifiers and related status). We also store the draft text we generate and associated review/citation metadata.

### 8) What do you store about my business documents (FAQs, itineraries, policies)?
We store your uploaded source documents and derived retrieval artifacts (chunks and embeddings) so the assistant can ground drafts in your approved content.

### 9) Do you store AI prompts/responses?
We store draft artifacts we generate, including citations and status needed for review and operations. We do not store full raw guest email bodies by default.

## D) How AI Processing Works (OpenAI)

### 10) What information is sent to the AI model?
Only the minimum needed to generate a draft: relevant email context plus selected snippets from your documents and policy instructions.

### 11) Do you send my entire document library to the AI each time?
No. We send only relevant retrieved snippets, not the full library.

### 12) Do you train AI models on our data?
Our policy is data minimization and controlled use for draft generation. Model-training use is governed by the provider terms and configuration in effect; we do not claim training behavior beyond what provider terms explicitly define.

## E) Tenant Isolation + Access Control

### 13) How do you prevent another customer from seeing our data?
Tenant isolation is a core requirement: data is tenant-scoped, queries are tenant-scoped, and cross-tenant access is blocked by design and database controls.

### 14) Who at your company can access our data?
Access is limited to authorized personnel who need it for operations/support, under least-privilege controls and audit logging.

### 15) Do you have admin/super-admin access? How is it controlled?
Privileged access may exist for controlled support/maintenance. It is tightly gated, limited, and audited. Admin UI workflows are tenant-scoped by default.

## F) Tokens, Credentials, Encryption

### 16) How do you store Gmail OAuth tokens?
Refresh tokens are treated as sensitive secrets and stored encrypted at rest with tenant/connection scoping. Access tokens are short-lived and should not be persistently stored.

### 17) Is data encrypted?
Yes, encryption at rest and in transit is part of the security posture for stored data and service communication.

### 18) Do you log sensitive data?
No. We do not log raw email bodies, attachments, OAuth tokens, API keys, or encryption secrets.

## G) Retention + Deletion

### 19) How long do you keep data?
Retention depends on data type. Examples: drafts/metadata/classification outcomes are 180 days, audit events are 1 year, logs are 30 days, metrics are 13 months, and backups are 35 days.

### 20) What happens if we disconnect Gmail?
We disable the mailbox connection, attempt provider revoke, and delete local token material. Non-token historical records follow the configured retention policy unless full tenant deletion is requested.

### 21) Can we delete our data? How long does it take?
Yes. Tenant deletion requests purge tenant-scoped data from primary systems with a target completion window of 7 days.

### 22) How do backups affect deletion?
Backups are retained for a limited window (35 days). Deleted primary data may remain in backups until those backups expire.

## H) Monitoring, Incident Response, and Reliability

### 23) How do you monitor the system for security issues?
We use structured logging, operational metrics, and audit events to monitor token health, processing failures, and abnormal patterns.

### 24) What happens if there's an incident?
We contain impact, disable affected paths when needed, rotate/revoke credentials, investigate via audit evidence, and require reconnect/recovery steps where appropriate.

### 25) Do you have a vulnerability disclosure process?
Use the support/security contact listed in your agreement to report potential vulnerabilities.

## I) Compliance + Legal

### 26) Are you SOC 2 / ISO certified?
We do not claim SOC 2 or ISO certification in this v1 documentation set.

### 27) Do you sign DPAs?
Contractual and DPA terms are handled through commercial/legal agreements.

### 28) Where is data hosted / data residency?
v1 is US-hosted. Regional hosting/residency options are planned for future phases.

## J) Human Review + Sensitive Topics

### 29) How do you handle refunds/safety/medical/legal emails?
Sensitive topics are flagged for human review and are not handled as fully automated sends. Operators remain decision-makers.

### 30) What gets flagged and who reviews it?
Policy-defined sensitive categories and uncertainty cases are flagged. Your authorized operator team reviews and approves/revises drafts before sending.

## Internal References

- Data map + classification (11.1): `docs/phases/phase-11-security/data-map-classification-v1.md`
- Tenant isolation requirements (11.2): `docs/phases/phase-11-security/tenant-isolation-requirements-v1.md`
- Token storage + secrets posture (11.3): `docs/phases/phase-11-security/token-storage-secrets-posture-v1.md`
- Retention + deletion policy (11.4): `docs/phases/phase-11-security/retention-deletion-policy-v1.md`
