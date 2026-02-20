# Phase 11.2 - Tenant Isolation Requirements (v1)

## A) Purpose + Non-Goals

Purpose:
- Freeze the v1 tenant isolation requirements that prevent cross-tenant data access.
- Define the enforcement model across data, storage, queues, observability, admin surfaces, and provider boundaries.
- Provide trust and architecture guardrails for security/sales review and later implementation.

Non-goals:
- Implementation details or code-level design.
- Dedicated database per tenant in v1.
- Compliance certification claims (for example SOC 2/ISO claims).

## B) Definitions

- Tenant: a customer account boundary for one operator organization.
- Operator: business entity using the product (outdoor/adventure travel operator).
- Mailbox connection: tenant-scoped provider connection used for Gmail (and later Outlook) access.
- User (human): authenticated person in admin/onboarding UI acting on behalf of one tenant.
- System actor: API/worker process acting on tenant-scoped jobs and data.
- Tenant boundary: any resource carrying `tenant_id` MUST never be readable or writable outside that same `tenant_id`.

## C) Isolation Model (Frozen Requirements)

v1 model:
- Single shared Postgres database with strict `tenant_id` scoping on tenant data, plus defense-in-depth controls.
- Postgres Row-Level Security (RLS) is REQUIRED and MUST be fully enforced before GA.

Core invariants:
- Every persisted tenant row is scoped to exactly one tenant.
- Every read/write query is tenant-scoped.
- Cross-tenant joins are forbidden unless explicitly permitted for anonymized global aggregates.
- Any exception path must be explicitly documented, access-controlled, and audited.

## D) DB Requirements (Postgres + pgvector)

MUST requirements:
- All tenant-scoped tables MUST include `tenant_id UUID NOT NULL`.
- Foreign keys MUST preserve tenant scoping and MUST NOT permit cross-tenant references.
- Unique constraints/indexes MUST include `tenant_id` where uniqueness is tenant-local.
- RLS (or equivalent DB-layer policy) MUST enforce tenant scoping as defense-in-depth.
- Migrations MUST NOT introduce unscoped tenant-data tables.
- Admin/service role bypass of RLS is allowed only for controlled maintenance operations and MUST be audited.
- Embeddings/vectors MUST be tenant-scoped, and every vector similarity query MUST apply tenant filtering.

Common failure modes checklist:
- Missing tenant predicate in an API/worker query.
- Background jobs executing without tenant context.
- Vector retrieval query missing tenant filter.
- Admin endpoints returning results across tenants.
- Analytics queries joining tenant data without scope constraints.

## E) Storage Requirements (S3-Compatible Docs)

- Object paths MUST be tenant-prefixed (for example `s3://<bucket>/tenants/<tenant_id>/...`).
- App access policy SHOULD be restricted to the configured bucket and enforce prefixes where possible.
- Object keys MUST NOT include guest/operator PII (for example names/emails in filenames/keys).
- Encryption at rest is expected for stored objects; storage access logging/auditing is recommended.
- Deleting a knowledge doc MUST trigger deletion of derived artifacts (chunks/embeddings) under retention/deletion policy defined later.

## F) Queue + Job Payload Requirements (BullMQ + Redis)

- Every job payload MUST include `tenant_id` and include `mailbox_connection_id` when the flow is mailbox/provider scoped.
- Workers MUST resolve all records by tenant-scoped lookups only.
- Job payloads MUST NOT contain raw email bodies or attachments by default (aligned with Step 11.1 minimization posture).
- Retry/replay flows MUST preserve original tenant context.
- Failure/dead-letter storage MUST avoid sensitive content payloads.

## G) Logging/Metrics/Tracing Requirements

- Logs MUST be tenant-aware and PII-minimized.
- Logs/traces SHOULD include `tenant_id` (or hashed tenant identifier where needed) for operations debugging.
- Logs MUST NEVER contain raw email bodies, attachments, access/refresh tokens, API keys, or secrets.
- Correlation IDs are allowed for traceability; avoid user/guest PII in tracing attributes.
- Cross-tenant metrics are allowed only as anonymized aggregates (counts, rates, percentiles) with no tenant/customer identifiers in shared dashboards.

## H) Admin/Onboarding Access Boundaries (Next.js Admin)

- Admin UI access MUST be tenant-scoped; users can only view/manage their own tenant.
- Super-admin capability (if introduced) MUST be explicit, least-privilege, break-glass-style, and fully audited.
- Support workflows MUST avoid cross-tenant browsing by default and rely on tenant-provided identifiers, audit trails, and scoped diagnostic views.

## I) Provider Integration Boundaries (Gmail Now, Outlook Later)

- The `MailProvider` abstraction MUST preserve tenant isolation semantics across providers.
- Provider tokens/credentials MUST be scoped to tenant + mailbox connection.
- Push/webhook events MUST resolve to tenant via a connection registry before processing.
- Gmail thread/message IDs MUST be treated as tenant-scoped identifiers (never assumed globally unique in internal models).
- Outlook support later MUST follow the same tenant-scoped provider contract without architecture rewrites.

## J) Audit Requirements (Docs-Only)

The system MUST conceptually capture payload-minimized audit events for:
- Tenant created/disabled.
- Mailbox connected/disconnected.
- Knowledge document uploaded/deleted.
- Token rotated/revoked (token values never logged).
- Role/permission changes.

Audit records should include actor type, tenant context, event type, timestamp, and correlation ID, without sensitive content payloads.

## K) Validation Checklist (For Future Implementation)

- [ ] DB: all tenant tables have `tenant_id`, tenant-safe constraints, and RLS coverage.
- [ ] DB: vector similarity queries always apply tenant filter.
- [ ] Storage: tenant prefixes are enforced and keys contain no PII.
- [ ] Queue: every job carries `tenant_id` (+ mailbox connection identifier where relevant).
- [ ] Workers: all lookups are tenant-scoped and replay preserves tenant context.
- [ ] Observability: no PII/secrets in logs; tenant-scoped diagnostic views only.
- [ ] Admin: tenant-scoped UI access and audited privileged overrides only.
- [ ] Provider boundary: tenant+connection scoped credentials and event routing.

## L) Cross-Reference Step 11.1

This isolation requirements spec aligns with the minimization posture defined in:
- `docs/phases/phase-11-security/data-map-classification-v1.md`

Isolation and minimization are joint controls: tenant boundaries prevent cross-tenant leakage, and minimization reduces what sensitive data exists to leak.
