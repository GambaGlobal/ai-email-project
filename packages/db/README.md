# DB Package

Purpose: Database client entrypoint and migrations home.

Migrations live in `packages/db/migrations` and are applied via `pnpm --filter @ai-email/db db:migrate`.
