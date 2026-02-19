#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f .env.local ]; then
  echo "Missing .env.local in repo root"
  exit 1
fi

# load env into process environment
set -a
source "$REPO_ROOT/.env.local"
set +a

# free port
lsof -nP -iTCP:3001 -sTCP:LISTEN -t | xargs -r kill -9 || true

# run API directly (no pnpm parent process)
cd "$REPO_ROOT/apps/api"
exec ./node_modules/.bin/tsx src/index.ts
