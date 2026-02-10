# DB Migrations

## Prerequisites
- A running Postgres instance (local Docker via `pnpm dev:infra` or any Postgres)
- `DATABASE_URL` set in your environment or `.env`

## Run Migrations
- `pnpm db:migrate`

## Rollback (1 step)
- `pnpm db:rollback`

## Create a Migration
- `pnpm db:create -- <name>`

## Notes
- Migrations live in `packages/db/migrations`.
