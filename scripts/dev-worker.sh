#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f .env.local ]; then
  echo "Missing .env.local in repo root"
  exit 1
fi

set -a
source "$REPO_ROOT/.env.local"
set +a

cd "$REPO_ROOT/apps/worker"
exec ./node_modules/.bin/tsx src/index.ts
