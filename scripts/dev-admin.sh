#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# (Admin likely doesn't need S3 env, but harmless)
if [ -f .env.local ]; then
  set -a
  source "$REPO_ROOT/.env.local"
  set +a
fi

cd "$REPO_ROOT/apps/admin"
exec pnpm dev
