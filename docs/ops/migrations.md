# Database Migrations

## Current tooling in this repo
This repository already uses **node-pg-migrate**.

Source of truth:
- Migration package: `packages/db`
- Migration files: `packages/db/migrations`
- Migration config: `packages/db/migrate.config.cjs`

Key scripts:
- Root wrapper: `pnpm -w db:migrate`
- Root rollback helper: `pnpm -w db:rollback`
- Root create helper: `pnpm -w db:create`
- Package-level equivalents:
  - `pnpm --filter @ai-email/db db:migrate`
  - `pnpm --filter @ai-email/db db:rollback`
  - `pnpm --filter @ai-email/db db:create`

## Canonical commands
From repo root, use:

```bash
DATABASE_URL="<target-db-url>" pnpm -w db:migrate
```

Create a new migration file:

```bash
pnpm -w db:create <migration_name>
```

Rollback one migration (use carefully):

```bash
DATABASE_URL="<target-db-url>" pnpm -w db:rollback
```

## Lifecycle policy (current)
- Staging: run migrations manually during deploy steps (current policy).
- Production: require explicit approval gates via GitHub environments in a later step (not implemented in this step).

## Rollback strategy (practical)
Application rollback:
- Revert the PR/commit and deploy the previous known-good app commit.

Database rollback:
- Preferred when safe: forward-fix with a new migration.
- If needed for recovery, use Neon restore/PITR capabilities to restore to a known-good point, then redeploy matching app code.
- Avoid ad hoc manual schema edits outside migrations unless handling an incident.

## Decision boundary for future steps
No new migration framework is needed now. Continue with `node-pg-migrate` unless a Decision Record amends the stack.
