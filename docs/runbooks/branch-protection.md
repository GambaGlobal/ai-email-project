# Branch Protection

## Enforce Required CI Gate
1. Go to `Settings` -> `Branches` -> `Branch protection rules` (or `Rulesets` if your org uses rulesets).
2. Add or edit the rule for `main`.
3. Enable `Require a pull request before merging`.
4. Enable `Require status checks to pass before merging`.
5. Select required status check `CI / smoke-gate`.
6. Recommended: enable `Require branches to be up to date before merging`.

## If `CI / smoke-gate` Is Not Selectable
1. Push to `main` or open a PR so the workflow runs at least once.
2. Return to branch protection settings and select `CI / smoke-gate`.

## Failure Logs
- Go to the failed Actions run.
- Open `Artifacts`.
- Download `ci-smoke-logs`.
