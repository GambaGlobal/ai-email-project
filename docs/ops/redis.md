# Staging Redis: Upstash

## Default provider choice
Use **Upstash** as the default managed Redis for staging.

Why Upstash (briefly):
- Managed Redis with low operational overhead.
- TLS-ready connection endpoints.
- Simple env-var based setup for API/worker deployments.

## Upstash setup checklist (UI)
1. Sign in to Upstash and create a Redis database.
- Suggested name: `ai-email-staging-redis`.
- Suggested type: standard Redis database suitable for BullMQ workloads.

2. Choose region.
- Pick the region closest to staging compute.
- If undecided now, choose **US-East** as default.

3. Copy connection details.
- Preferred: full TLS URL (`rediss://...`).
- If UI provides split values, copy and keep:
  - host
  - port
  - password

4. Store credentials securely.
- Save in password manager / provider secrets.
- Do not put credentials in git-tracked files.

## Current Redis integration in this repo
Current code and scripts use Redis with these libraries:
- `bullmq`
- `ioredis`
- `redis` (node-redis client in API OAuth state storage)

Primary environment variable in current code:
- `REDIS_URL`

Where `REDIS_URL` is required:
- API queue integrations: `apps/api/src/lib/docs-queue.ts`, `apps/api/src/lib/mail-notifications-queue.ts`, `apps/api/src/lib/mailbox-sync-queue.ts`
- API OAuth state Redis client: `apps/api/src/lib/redis.ts`
- Worker runtime: `apps/worker/src/index.ts`
- Operator/queue scripts: multiple files under `scripts/` (for example `scripts/queue-status.mjs`, `scripts/ops-monitor.mjs`)

For staging, set only:
- `REDIS_URL=<upstash-rediss-url>`

## Security baseline
- Treat `REDIS_URL` (and password/host/port) as secrets; never commit them.
- Prefer TLS endpoint (`rediss://`) for hosted environments.
- Rotate Redis credentials immediately if leaked.
- Avoid exposing Redis beyond provider-managed access controls.

## Verification (later deploy steps)
After API and worker are deployed with `REDIS_URL` configured:
1. API starts successfully with no Redis config errors.
2. Worker starts and connects without crash/restart loops.
3. Queue flow can enqueue and process a simple no-op job (covered in a later step).

This step adds documentation only; no code or env changes are made here.
