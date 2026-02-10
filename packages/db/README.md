# DB Package

Purpose: Database client entrypoint and migrations home.

Migrations live in `packages/db/migrations` and are applied via `pnpm --filter @ai-email/db db:migrate`.

## Tenant isolation (RLS)
Set the tenant for a session:
`SET app.tenant_id = '<uuid>';`

Run the RLS verification script (local):
`psql "$DATABASE_URL" -f packages/db/verify/rls-smoke.sql`

Caveat: table owners and superusers bypass RLS unless `FORCE ROW LEVEL SECURITY` is enabled. In production, use a dedicated app role that is not the table owner.
