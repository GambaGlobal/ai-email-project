# GCP Staging

## Billing + Project Baseline (Staging)
- GCP Project Name: Ai-email-project
- GCP Project ID: ai-email-project-488406
- Billing Account Name: AI-email-project
- Billing Account ID: 012F1C-28E95A-488924

Why this matters: budgets/alerts are configured at the Billing Account and scoped to the Project.

Cost guardrails reference: [GCP staging budget + alerts (4G.2)](./cost-guardrails.md).
Cloud Run cost controls reference: [Cloud Run Cost Controls (Staging) — 4G.5](./cloud-run-cost-controls.md).

### Evidence
Billing is enabled for the staging project and attached to the billing account above (confirmed in GCP Console Billing page).

## Project Baseline Security (4.2)
- Project name: Ai-email-project
- Project ID: ai-email-project-488406
- Project number: 298473155774
- Billing account: AI-email-project (012F1C-28E95A-488924)
- Region decision (Cloud Run + Artifact Registry): us-east1
- IAM sanity notes:
  - Primary owner identity: designwithbrandon@gmail.com
  - Unexpected principals: None observed (Only expected principals present)
- Evidence checklist:
  - Project number recorded
  - Region decision recorded
  - IAM reviewed (no unexpected access)

Step 4.3 enabled minimal required APIs; see [Required APIs Enabled (4.3)](./cost-guardrails.md#required-apis-enabled-43).
