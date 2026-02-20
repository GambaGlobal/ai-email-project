# DR-0007: Phase 2 — Architecture Lock (MailProvider + Event Pipeline)

Status: Accepted
Date: 2026-02-10

## Context
- Gmail-first, drafts inside inbox, human-in-control.
- Multi-tenant from day one.
- Outlook later without rewrites via MailProvider abstraction.
- Trust/reliability focus; sensitive messages flagged for review.

## Decisions
- Event-driven pipeline: Provider notification → API webhook → queue → worker → draft creation.
- Provider boundary: Gmail-specific logic behind MailProvider; core uses canonical types only.
- Idempotency: one draft per (tenant_id, mailbox_id, provider_message_id) by default.
- Guardrails-first: classify sensitivity before drafting; sensitive routes to human review (no guest-ready draft by default).
- Auditability: append-only audit_event per run; drafts link to run/evidence inputs.
- Multi-tenancy enforcement: tenant isolation enforced structurally at the data layer (tenant_id required on core rows, scoped queries by tenant_id, and mailbox ownership enforced via constraints).

## Options Considered
- Provider-owned pipeline (fast now, rewrite later).
- Polling ingestion (simpler infra, worse trust/latency).

## Consequences
- Higher reliability + lower rewrite risk.
- Requires disciplined canonical schema + idempotency + auditing from day one.
