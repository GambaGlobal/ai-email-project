# Branch Protection

## Enforce Required CI Gate
1. Open repository `Settings` -> `Branches`.
2. Add rule or edit rule for branch name pattern `main`.
3. Enable `Require a pull request before merging`.
4. Enable `Require status checks to pass before merging`.
5. Search and select required check `CI / smoke-gate`.
6. Recommended: enable `Require branches to be up to date before merging`.

## If `CI / smoke-gate` Is Not Selectable
1. Push to `main` or open a PR so the workflow runs at least once.
2. Return to branch protection settings and select `CI / smoke-gate`.

## Failure Artifacts
1. Open `Actions`.
2. Open the failed workflow run.
3. Open `Artifacts`.
4. Download `ci-smoke-logs`.

## PR Proof Checklist
1. Open the PR and confirm check `CI / smoke-gate` starts automatically.
2. Confirm the run executes smoke sequence:
   - `smoke:correlation`
   - `smoke:notify-dedupe`
   - `smoke:notify-fanout`
   - `smoke:notify-coalesce`
   - `smoke:notify-historyid`
   - `smoke:notify-poison`
   - `smoke:mailbox-sync-run`
3. If the check fails, download `ci-smoke-logs` and inspect by correlation id:
   - `rg -a "<correlationId>" /tmp/ai-email-api.log`
   - `rg -a "<correlationId>" /tmp/ai-email-worker.log`

## Local Mirror Of CI
- `pnpm -w install --frozen-lockfile`
- `pnpm -w repo:check`
- `pnpm -w db:migrate`
- Start API and worker.
- `pnpm -w smoke:correlation`
- `pnpm -w smoke:notify-dedupe`
- `pnpm -w smoke:notify-fanout`
- `pnpm -w smoke:notify-coalesce`
- `pnpm -w smoke:notify-historyid`
- `pnpm -w smoke:notify-poison`
- `pnpm -w smoke:mailbox-sync-run`
