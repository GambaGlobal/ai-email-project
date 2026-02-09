# 0001 - Tech Stack

Status: Accepted
Date: 2026-02-09

## Context
We are building a Gmail-first AI Inbox Copilot for outdoor/adventure travel operators. v1 must be drafts only (never auto-send). A stable, scalable stack is required for admin UI, API, background processing, storage, and integrations.

## Decision
Adopt the following stack (canonical):
- TypeScript monorepo
- Next.js admin
- Node API + Worker
- Postgres + pgvector
- Redis + BullMQ
- S3-compatible storage
- Gmail API + Pub/Sub
- OpenAI Responses behind wrapper

## Consequences
- All implementation must conform to this stack.
- Any stack change requires amending this Decision Record.
