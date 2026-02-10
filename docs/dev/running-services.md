# Running Services

## API
- Start: `pnpm --filter @ai-email/api dev`
- Health check: `curl http://localhost:3001/healthz`

## Worker
- Start: `pnpm --filter @ai-email/worker dev`

## Notes
- API uses `PORT` (default 3001) and `HOST` (default 0.0.0.0).
