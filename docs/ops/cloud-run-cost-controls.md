# Cloud Run Cost Controls (Staging) — 4G.5

Use these defaults for all staging Cloud Run services (API + worker) to keep costs near $0 while building.

## Default Controls
- Min instances: `0`
  - Meaning: service scales to zero when idle so there is no always-on compute charge.
- Max instances: `1`
  - Meaning: caps spend and prevents accidental scale-outs during early staging.
- CPU allocation: CPU only during request
  - Meaning: no idle CPU billing between requests.
- Memory: start with smallest that works
  - Meaning: keep memory cost low until real load proves a larger size is required.
- Concurrency: `1` initially
  - Meaning: safest default while debugging; reduce noisy shared-state issues before tuning throughput.
- Request timeout: `300s` default (allowed range `60-300s`)
  - Meaning: allows longer debug requests without infinite hangs; tune down later if possible.
- Ingress: allow `All` only if OAuth callback needs it; otherwise restrict later
  - Meaning: keep public exposure minimal; tighten ingress once callback requirements are confirmed.
- Scaling escape hatch: temporarily raise max instances for debugging, then revert
  - Meaning: short-term scaling is allowed for troubleshooting, but defaults must be restored.

## How To Set In Console
- Cloud Run → `<service>` → Edit & deploy new revision → Autoscaling / Container settings

## How To Verify After Deploy
- Open Cloud Run service → Revisions → confirm Min instances = `0` and Max instances = `1`.
- Confirm CPU allocation is set to request-only (no idle CPU).
- Confirm Concurrency = `1` and Request timeout = `300s` (or approved override).

## Security TODO
- Revisit ingress policy after OAuth callback path is verified and restrict ingress where possible.

## Rollback / Escape Hatch
- Roll back to prior revision if a new config causes errors.
- Temporarily increase max instances for debugging, then revert to `1`.
- Scale to `0` or delete the service when no longer needed.
