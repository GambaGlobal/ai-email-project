# Vercel Admin Staging Setup (`apps/admin`)

This runbook records the known-good Vercel configuration for the Admin app in this monorepo and how to reproduce it.

## Project naming and structure

- Create/use a dedicated staging Vercel project: `ai-email-admin-staging`.
- Later create a separate production Vercel project: `ai-email-admin-prod`.
- This repository is a monorepo. The Admin app lives at `apps/admin`.

## Known-good Vercel project settings

Set these in Vercel Project Settings:

- Framework Preset: `Next.js`
- Root Directory: `apps/admin`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm build`
- Output Directory: keep default for Next.js
- Node.js Version: prefer `20.x` if configurable

Why build command is `pnpm build`:
- With Root Directory set to `apps/admin`, Vercel runs commands from inside that directory.
- Do not use `pnpm -C apps/admin build` in this setup.

## GitHub integration and deploy behavior

- Connect the Vercel project to this repository on GitHub.
- Production Branch: `main`
- Preview Deployments: enabled by default for PRs/branches.
- Keep preview/staging URLs unshared while the product is private.

## Keep staging dark (private before launch)

Current practical approach:
- Do not share the staging URL publicly.
- Do not attach a public custom domain yet.

Planned hardening in a later step:
- Add a Google SSO gate for admin access.
- Add `X-Robots-Tag: noindex` and robots controls (documented now, not implemented in this step).

## Environment variable inventory (from `apps/admin` code)

Inventory source commands:
- `rg -n "process\\.env\\." apps/admin`
- `rg -n "NEXT_PUBLIC_" apps/admin`
- `rg -n "NEXTAUTH|AUTH|SSO|OIDC" apps/admin`
- `rg -n "API_BASE|BASE_URL|BACKEND|FASTIFY|apps/api" apps/admin`
- `ls -la apps/admin`
- `ls -la apps/admin | rg -n "\\.env"`
- `rg -n "env\\." apps/admin/next.config.* apps/admin/**`

Result summary:
- No `.env*` files currently present in `apps/admin`.
- No `NEXTAUTH`, `SSO`, `OIDC`, or server-only env usage found in `apps/admin`.
- Two `process.env` variables are used, both `NEXT_PUBLIC_*`.

### `NEXT_PUBLIC_API_BASE_URL`

- Exposure: `NEXT_PUBLIC` (client-exposed at build output).
- Usage context:
  - `apps/admin/app/onboarding/page.tsx`
  - `apps/admin/app/system-health/page.tsx`
  - `apps/admin/app/components/docs-manager.tsx`
- Likely purpose:
  - Base URL for API calls like `/v1/auth/gmail/start`, `/v1/mail/gmail/connection`, `/v1/docs`.
- Build/runtime requirement (best effort):
  - Not hard-required for a successful build.
  - Required for real API mode at runtime; without it, UI falls back to offline/demo behavior.
- Placeholder value pattern:
  - `https://<staging-api-domain>`

### `NEXT_PUBLIC_TENANT_ID`

- Exposure: `NEXT_PUBLIC` (client-exposed at build output).
- Usage context:
  - `apps/admin/app/onboarding/page.tsx`
  - `apps/admin/app/system-health/page.tsx`
  - `apps/admin/app/components/docs-manager.tsx`
- Likely purpose:
  - Tenant identifier sent as `x-tenant-id` for multi-tenant API requests.
- Build/runtime requirement (best effort):
  - Not hard-required for a successful build.
  - Required (with `NEXT_PUBLIC_API_BASE_URL`) for full real API mode; otherwise code defaults to `DEFAULT_DEV_TENANT_ID` and/or demo flows.
- Placeholder value pattern:
  - `<staging-tenant-id>`

## Vercel env setup checklist (staging)

In Vercel project `ai-email-admin-staging`, add:

- `NEXT_PUBLIC_API_BASE_URL=https://<staging-api-domain>`
- `NEXT_PUBLIC_TENANT_ID=<staging-tenant-id>`

Apply to environments:
- `Preview` (required for branch/PR validation)
- `Production` (required because this project's production branch is `main`)

## Evidence gate checklist

- A commit pushed to GitHub triggers Vercel deploy for the staging project.
- Deployment status is `Ready` in Vercel.
- Admin URL loads without platform/runtime crash.
- Real mode validation:
  - With env vars set, onboarding/system-health/docs screens hit API endpoints.
  - Without env vars, app stays in documented offline/demo mode.
- Rollback test:
  - Use Vercel "Redeploy" on a previous successful commit and confirm URL still loads.
