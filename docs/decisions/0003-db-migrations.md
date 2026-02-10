# 0003 - DB Migrations

## Context
We need a repeatable, monorepo-owned way to run Postgres migrations while keeping provider and app logic separate. We also need pgvector enabled and a minimal multi-tenant baseline schema without committing to an ORM yet.

## Decision
- Centralize migrations under `packages/db`.
- Use `node-pg-migrate` for migrations (SQL-first via JS migration files).
- Keep the initial schema minimal: `tenants`, `mailboxes`, `telemetry_events`, plus required extensions.
- Defer ORM selection until later.

## Alternatives
- Prisma, Drizzle, or Kysely (rejected for now to avoid premature ORM choice).
- Plain SQL scripts without a migration runner (rejected due to poor repeatability and rollback story).

## Consequences
- Database changes must be expressed as migrations in `packages/db/migrations`.
- Local dev uses a single `DATABASE_URL` to run migrations.

## Date
2026-02-09
