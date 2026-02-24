# GitHub to GCP WIF (Staging) - 4.4

## Purpose
Use keyless GitHub Actions authentication to GCP using Workload Identity Federation (WIF), with no service account keys stored in GitHub.

## Configuration
- Project ID: `ai-email-project-488406`
- Project number: `298473155774`
- Region: `us-east1`
- Workload Identity Pool: `github-pool` (global)
- Workload Identity Provider: `github-provider` (global)
- Issuer URL requirement: `https://token.actions.githubusercontent.com`

## OIDC Mapping and Restriction
- Attribute mapping:
  - `google.subject = assertion.sub`
  - `attribute.repository = assertion.repository`
- Attribute condition:
  - `attribute.repository == "GambaGlobal/ai-email-project"`

## Provider and Service Account
- Provider resource name:
  - `projects/298473155774/locations/global/workloadIdentityPools/github-pool/providers/github-provider`
- Service account:
  - `github-deploy-staging@ai-email-project-488406.iam.gserviceaccount.com`

## IAM Impersonation Binding
- Principal:
  - `principalSet://iam.googleapis.com/projects/298473155774/locations/global/workloadIdentityPools/github-pool/attribute.repository/GambaGlobal/ai-email-project`
- Role:
  - `roles/iam.workloadIdentityUser`

## GitHub Repository Secrets
- `GCP_WIF_PROVIDER`
- `GCP_SERVICE_ACCOUNT`

