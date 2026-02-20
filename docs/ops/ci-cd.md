# CI/CD: Required Checks

## Workflow scope
- Workflow file: `.github/workflows/ci.yml`
- Workflow name: `CI`
- Job name: `checks`
- Triggers:
  - `pull_request` (required check target)
  - `push` to `main` (recommended)

This workflow runs repository quality checks only. It does not deploy and does not use secrets.

## What CI runs
1. Checks out the repository.
2. Sets up Node.js 20 (LTS).
3. Enables pnpm with Corepack.
4. Installs dependencies with lockfile enforcement:
   - `pnpm -w install --frozen-lockfile`
5. Selects quality gate commands from `package.json` scripts:
   - Preferred: `pnpm -w repo:check` (if script exists)
   - Fallback: run only scripts that exist from this set:
     - `pnpm -w lint`
     - `pnpm -w typecheck`
     - `pnpm -w test`
     - `pnpm -w build`
6. Runs selected commands.

Caching: pnpm store cache is enabled through `actions/setup-node`.

## Run the same checks locally
From repo root:

```bash
pnpm -w install --frozen-lockfile
pnpm -w repo:check
```

If `repo:check` is not defined, run whichever scripts exist:

```bash
pnpm -w lint
pnpm -w typecheck
pnpm -w test
pnpm -w build
```

## Branch protection target
After this workflow runs once on a PR, configure branch protection required status check to:
- `CI / checks`

## Rollback / escape hatch
- Rollback: revert the PR or revert commit `ci: add required checks workflow`.
- If CI blocks all PRs, temporarily remove the required status check in GitHub branch protection, then restore it after fix.
