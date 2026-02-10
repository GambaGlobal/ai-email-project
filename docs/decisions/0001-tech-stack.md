# 0001 - Tech Stack

Status: Accepted
Date: 2026-02-09

## Context
We are building a Gmail-first AI Inbox Copilot for outdoor/adventure travel operators. v1 must be drafts only (never auto-send). A stable, scalable stack is required for admin UI, API, background processing, storage, and integrations.

This Decision Record is the source of truth for stack choices. Any change requires an amendment Decision Record in `docs/decisions/`.

## Decision
Adopt the following stack (canonical):
- Monorepo: TypeScript, pnpm, Turborepo
- Web: Next.js (admin/onboarding)
- API: Node.js TypeScript (framework decision in DR-0002)
- Worker: Node.js TypeScript
- DB: Postgres + pgvector
- Queue: BullMQ + Redis
- Storage: S3-compatible for docs
- Email provider: Gmail API + Google Cloud Pub/Sub push notifications
- AI: OpenAI (Responses API) behind an internal wrapper

## Consequences
- All implementation must conform to this stack.
- Any stack change requires amending this Decision Record via a new Decision Record.
