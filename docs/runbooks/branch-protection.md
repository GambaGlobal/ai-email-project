# Branch Protection

## Enforce Required CI Gate
1. Open repository `Settings` -> `Branches`.
2. Add rule or edit rule for branch name pattern `main`.
3. Enable `Require a pull request before merging`.
4. Enable `Require status checks to pass before merging`.
5. Search and select required check `CI / checks`.
6. Recommended: enable `Require branches to be up to date before merging`.

## If `CI / checks` Is Not Selectable
1. Push to `main` or open a PR so the workflow runs at least once.
2. Return to branch protection settings and select `CI / checks`.

## Failure Artifacts
1. Open `Actions`.
2. Open the failed workflow run.
3. Open `Artifacts`.
4. Download `ci-smoke-logs`.

## CI proof (deterministic)
Required-check existence proof:
1. Open `Settings` -> `Branches` -> `Branch protection rules`.
2. Add or edit rule for `main`.
3. Enable `Require status checks to pass before merging`.
4. Search and select `CI / checks`.

PR run proof:
1. Open the PR.
2. Open the `Checks` tab.
3. Verify `CI / checks` ran and is green.

Failure artifact proof:
1. From PR `Checks`, open `Details` for `CI / checks`.
2. In Actions run details, open `Artifacts`.
3. Download `ci-smoke-logs`.

Copy/paste PR checklist:
```md
- [ ] CI / checks ran on this PR
- [ ] checks passed (or failure investigated via ci-smoke-logs)
- [ ] Local mirror command sequence executed (optional but recommended)
```

Local mirror of CI:
- `pnpm -w repo:check`
- `pnpm -w dev:down || true`
- `pnpm -w dev:up`
- `pnpm -w smoke:correlation`
- `pnpm -w smoke:notify-dedupe`
- `pnpm -w smoke:notify-fanout`
- `pnpm -w smoke:notify-coalesce`
- `pnpm -w smoke:notify-historyid`
- `pnpm -w smoke:notify-poison`
- `pnpm -w smoke:mailbox-sync-run`
- `pnpm -w dev:down`

Note: full validation is enforced on PR/push in GitHub; this local mirror reduces surprises before push.
