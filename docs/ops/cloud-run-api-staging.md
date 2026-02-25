# Cloud Run API Staging Deployment (4.6)

## Service / Region / Workflow
- Cloud Run service: `ai-email-api-staging`
- Region: `us-east1`
- GitHub Actions workflow: `.github/workflows/deploy-api-staging.yml`
- Trigger: manual (`workflow_dispatch`)
- Required APIs are enabled manually in GCP Console.
- The workflow does not run `gcloud services enable` to keep WIF least-privilege.
- Cloud Build uses `apps/api/cloudbuild.yaml` to build `apps/api/Dockerfile` with repo root (`.`) as context.

## Cost Cap Settings
Configured in deploy command:
- `min instances = 0`
- `max instances = 1`
- `CPU allocation = request-only` (`--cpu-throttling`)
- `concurrency = 1`
- `memory = 256Mi`
- `timeout = 300s`

## Secrets Mapped to Cloud Run
Mapped using `--update-secrets`:
- `DATABASE_URL` <- Secret Manager `DATABASE_URL:latest`
- `REDIS_URL` <- Secret Manager `REDIS_URL:latest`
- `TOKEN_ENCRYPTION_KEY` <- Secret Manager `TOKEN_ENCRYPTION_KEY:latest`
- `ADMIN_BASE_URL` <- Secret Manager `ADMIN_PUBLIC_URL:latest`

Additional runtime env values set in deploy command:
- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `S3_REGION=us-east1`
- `S3_BUCKET=ai-email-staging-docs`

## Health Endpoint Evidence
- Endpoint: `https://<cloud-run-url>/health`
- Verification step in workflow:
  - Resolve Cloud Run URL via `gcloud run services describe ... --format='value(status.url)'`
  - Run `curl --fail "${SERVICE_URL}/health"`
- Expected result: HTTP `200`

## Rollback / Escape Hatch
- Roll back traffic to a prior working revision in Cloud Run.
- Delete service `ai-email-api-staging` to stop spend.
- Disable workflow `.github/workflows/deploy-api-staging.yml` if needed.
