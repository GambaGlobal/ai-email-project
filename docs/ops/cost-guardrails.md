# Cost Guardrails

## GCP Staging Budget (4G.2)
- Billing Account Name: AI-email-project
- Billing Account ID: 012F1C-28E95A-488924
- Staging GCP Project Name: Ai-email-project
- Staging GCP Project ID: ai-email-project-488406
- Applies to: This billing account
- Budget name: Staging
- Budget period: Monthly
- Budget type: Specified amount
- Trigger alerts at: 50%, 90%, and 100%
- Spend and budget amount: $0.00 / $10.00
- Credits: No credits used

“Applies to: This billing account” means the budget scope is the entire billing account, not a single project. This is acceptable only because the billing account currently contains a single project. If additional projects are added (e.g., production), this budget would cover them too, and must be changed to project-only scope.

Console click path:
- Billing → Budgets & alerts → Staging

Evidence checklist:
- Budget appears in Budgets & alerts list
- Applies to shows “This billing account”
- Thresholds show 50/90/100
- Amount shows $10/month

## Budget Alert Delivery (4G.3)
- Budget: Staging
- Delivery model: Role-based email (Billing Account admins and users)
- Notification setting: “Email alerts to billing admins and users” enabled
- Billing account: AI-email-project (012F1C-28E95A-488924)
- Verified recipient role:
  - Principal: designwithbrandon@gmail.com
  - Role: Billing Account Administrator
- Console paths:
  - Billing → Budgets & alerts → Staging → Notifications
  - Billing → Account management → Manage users (billing account) → add/verify principal role

Evidence checklist:
- Alerts enabled for billing admins/users
- User verified as Billing Account Administrator on the billing account
- Budget still shows thresholds 50/90/100 and appears in Budgets & alerts list

## Cloud Logging Retention (4G.4)
- Project: Ai-email-project (ai-email-project-488406)
- Bucket: _Default (Default bucket)
- Retention period: 7 days
- Region: global
- Log Analytics: Disabled
- BigQuery analysis: Disabled
- Console click path:
  - Logging → Logs Storage → Log buckets → _Default → Retention period → set to 7 days → Save
- Plain-English meaning:
  - Logs auto-expire quickly so staging doesn’t accumulate paid log storage over time.
- Evidence checklist:
  - Bucket details page shows Retention period = 7 days

## Enabled Services Policy (4G.6)
- Project: Ai-email-project (ai-email-project-488406)
- Minimal allowed set (early staging): Cloud Run, Cloud Build, Artifact Registry, Secret Manager, Gmail API (+ core dependencies)
- Observed enabled services (as of 2026-02-24):
  - Analytics Hub API
  - BigQuery API
  - BigQuery Connection API
  - BigQuery Data Policy API
  - BigQuery Data Transfer API
  - BigQuery Migration API
  - BigQuery Reservation API
  - BigQuery Storage API
  - Cloud Dataplex API
  - Cloud Datastore API
  - Cloud Logging API
  - Cloud Monitoring API
  - Cloud SQL
  - Cloud Storage
  - Cloud Storage API
  - Cloud Trace API
  - Dataform API
  - Google Cloud APIs
  - Google Cloud Storage JSON API
  - Service Management API
  - Service Usage API
- Services disabled during audit:
  - None
- Console click path:
  - APIs & Services → Enabled APIs & services
- Plain-English meaning:
  - Fewer enabled services = fewer surprise charges and fewer accidental dependencies.
- Evidence checklist:
  - Observed list recorded
  - Services disabled recorded as “None”
