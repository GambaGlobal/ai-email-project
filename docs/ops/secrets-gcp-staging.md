# GCP Secret Manager — Staging Inventory (4.5)

## Project / Region
- Project name: `Ai-email-project`
- Project ID: `ai-email-project-488406`
- Project number: `298473155774`
- Region: `us-east1`

## Secret Inventory (Names Only)
| Secret Name | Purpose |
| --- | --- |
| `ADMIN_PUBLIC_URL` | Public URL for the staging admin app used by API/worker callbacks and environment wiring. |
| `API_PUBLIC_URL` | Public base URL for the staging API used by admin/runtime integrations. |
| `DATABASE_URL` | Staging Postgres connection string for API/worker runtime database access. |
| `GOOGLE_CLIENT_ID` | OAuth client ID used for Google/Gmail authentication flows in staging. |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret paired with `GOOGLE_CLIENT_ID` for staging auth flows. |
| `GOOGLE_REDIRECT_URI` | OAuth redirect URI registered for the staging Google app. |
| `REDIS_URL` | Staging Redis connection string for queues and transient runtime storage. |
| `TOKEN_ENCRYPTION_KEY` | Key used by the application to encrypt sensitive token material at rest. |

## Access Model
- Service account: `github-deploy-staging@ai-email-project-488406.iam.gserviceaccount.com`
- IAM role: `Secret Manager Secret Accessor`
- Scope model: per-secret binding (preferred), not broad project-wide access where avoidable.

## Rotation Notes
- `TOKEN_ENCRYPTION_KEY` is high-impact: rotating it invalidates existing encrypted tokens unless the application supports key versioning and re-encryption.
- `DATABASE_URL` and `REDIS_URL` should be rotated by adding/updating secret versions and rolling deploys to pick up the latest version.

## Console Paths
- Google Cloud Console: `Security` -> `Secret Manager`
- Secret-level IAM: open a secret -> `Permissions`
