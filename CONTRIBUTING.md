# Contributing

## Before Opening A PR
- `pnpm -w install --frozen-lockfile`
- `pnpm -w repo:check`
- `pnpm -w dev:up`
- `pnpm -w smoke:correlation`
- `pnpm -w dev:down`

## CI Is Required
- Required status check: `CI / smoke-gate`.
- GitHub only lets you select a required check after it has run at least once on the repository.

## Local Dev Environment
Set these env vars for local development:
- `REDIS_URL=redis://127.0.0.1:6379`
- `DATABASE_URL=postgresql://127.0.0.1:5432/ai_email_dev`
- `DOCS_STORAGE=local`
- `DOCS_LOCAL_DIR=/tmp/ai-email-docs`
- `TENANT_AUTOSEED=1`

For pnpm store-dir guidance (to avoid local `.pnpm-store/` noise), see `docs/runbooks/pilot-runbook.md`.
