# Staging Infrastructure Baseline

Staging baseline services for this repo:
- Postgres (Neon): see `docs/ops/staging-infra.md` section below.
- Redis (Upstash): see `docs/ops/redis.md`.

## Default choice for staging Postgres
For staging, use **Neon** as the managed Postgres provider.

Why Neon (briefly):
- Managed Postgres with low ops overhead.
- Fast branch/database workflows for staging environments.
- Built-in backup/restore capabilities that reduce manual DBA work.

## Neon setup steps (UI)
Use these steps in Neon UI (no code changes required in this step):

1. Sign in to Neon and create a new project.
- Suggested project name: `ai-email-staging`.
- Choose a region close to your app hosting region.

2. Create (or confirm) a staging database in that project.
- Suggested DB name: `ai_email_staging`.

3. Create a dedicated staging DB user/role (do not use owner/root for app runtime).
- Suggested username: `ai_email_staging_app`.
- Save the generated password in your password manager.

4. Copy the connection string for that staging user.
- This is your staging `DATABASE_URL`.
- Do not paste it into code, docs, or git-tracked files.

5. Keep the value ready for later deployment steps.
- Later, set `DATABASE_URL` in hosting provider secrets (Vercel/Fly/Render).
- Do not set provider secrets in this step.

## Security notes
- Use least-privilege credentials for app runtime. Keep an elevated/admin user for manual maintenance only.
- Assume the database endpoint is reachable over the internet unless restricted by provider/network controls. Use strong credentials and rotate them on schedule.
- Treat all connection strings as secrets. Never commit DB URLs to git.
- Store DB URLs only in secret managers/provider env settings (for example: Vercel Project Environment Variables, Fly secrets, Render Environment Groups).

## Verification (to run in later steps)
After `DATABASE_URL` is configured in the target environment, verify connectivity with migration tooling:

```bash
DATABASE_URL="<staging-neon-url>" pnpm -w db:migrate
```

Expected result:
- Initial run applies pending migrations successfully.
- Subsequent run reports no pending migrations.

This confirms app-level DB connectivity and migration access.
