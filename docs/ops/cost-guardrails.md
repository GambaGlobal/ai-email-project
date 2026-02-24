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
