# Project Law (AGENTS)

## Workflow
- Work is organized as: Phase → Milestone → Step.
- One Step = one diff = one commit.
- Always show `/diff` before commit.
- Run available checks for each step.
- After pushing, stop and wait for review.

## Stack Lock
- TypeScript monorepo
- Next.js admin
- Node API + Worker
- Postgres + pgvector
- Redis + BullMQ
- S3-compatible storage
- Gmail API + Pub/Sub
- OpenAI Responses behind wrapper

## Change Control
- No stack changes without a Decision Record amendment.
- Canonical stack is in `docs/decisions/0001-tech-stack.md` and must be followed.

## Governance Artifacts
- Decisions live in `docs/decisions/`.
- Step ledger lives in `docs/step-ledger.md`.

## Repo Commands (if available)
- Install: `pnpm install`
- Dev: `pnpm dev` (or turbo equivalent)
- Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`

## Boundaries
- `apps/*` for product surfaces; `packages/*` for shared code.
- Provider-specific code must not leak into core logic.

## Style
- Prefer small, reviewable diffs.
- Avoid refactors unless requested; explain tradeoffs briefly.
