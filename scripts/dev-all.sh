#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f .env.local ]; then
  echo "Missing .env.local in repo root"
  exit 1
fi

# export env for children
set -a
source "$REPO_ROOT/.env.local"
set +a

API_PORT="${API_PORT:-3001}"
ADMIN_PORT="${ADMIN_PORT:-3000}" # change if yours differs

log() { echo "[$(date +%H:%M:%S)] $*"; }

cleanup() {
  log "Stopping dev processes..."
  for pidfile in /tmp/ai-email-*.pid; do
    [ -f "$pidfile" ] || continue
    pid="$(cat "$pidfile" || true)"
    [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null || true
  done
  sleep 1
  for pidfile in /tmp/ai-email-*.pid; do
    [ -f "$pidfile" ] || continue
    pid="$(cat "$pidfile" || true)"
    [ -n "${pid:-}" ] && kill -9 "$pid" 2>/dev/null || true
    rm -f "$pidfile" || true
  done
  log "Done."
}
trap cleanup INT TERM EXIT

# free ports
log "Freeing ports $API_PORT and $ADMIN_PORT..."
lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN -t | xargs -r kill -9 || true
lsof -nP -iTCP:"$ADMIN_PORT" -sTCP:LISTEN -t | xargs -r kill -9 || true

# start API
log "Starting API..."
rm -f /tmp/ai-email-api.log /tmp/ai-email-api.pid
( cd "$REPO_ROOT/apps/api" && exec ./node_modules/.bin/tsx src/index.ts ) > /tmp/ai-email-api.log 2>&1 &
echo $! > /tmp/ai-email-api.pid

# start Worker
log "Starting Worker..."
rm -f /tmp/ai-email-worker.log /tmp/ai-email-worker.pid
( cd "$REPO_ROOT/apps/worker" && exec ./node_modules/.bin/tsx src/index.ts ) > /tmp/ai-email-worker.log 2>&1 &
echo $! > /tmp/ai-email-worker.pid

# start Admin (choose ONE)
log "Starting Admin..."
rm -f /tmp/ai-email-admin.log /tmp/ai-email-admin.pid
( cd "$REPO_ROOT/apps/admin" && exec ./node_modules/.bin/next dev -p "$ADMIN_PORT" ) > /tmp/ai-email-admin.log 2>&1 &
echo $! > /tmp/ai-email-admin.pid

log "Tailing logs (Ctrl+C to stop all)..."
tail -n 200 -f /tmp/ai-email-api.log /tmp/ai-email-worker.log /tmp/ai-email-admin.log
