# Phase 11.3 - Token Storage & Secrets Posture (v1)

## A) Purpose + Scope

Purpose:
- Define how v1 secures tokens and secrets to reduce account takeover risk and prevent cross-tenant leakage.
- Freeze policy-level requirements used by engineering, trust, and sales/security review.

Scope:
- Gmail OAuth credentials (authorization code, refresh token, access token)
- Google Pub/Sub credentials and service auth context (where applicable)
- OpenAI API keys
- Postgres and Redis credentials
- Encryption keys for token protection
- Webhook verification secrets (future provider/webhook integrations)
- Admin app session cookies and related signing secrets

## B) Guiding Principles

- Secrets are radioactive: never log, minimize handling, encrypt at rest, least privilege, rotate, and audit.
- Tokens are tenant + connection scoped: every provider credential belongs to one `tenant_id` and one mailbox connection.
- Access tokens are short-lived: avoid persistent storage; refresh on demand.
- Security controls must align with tenant isolation (Step 11.2) and data minimization (Step 11.1).

## C) Token Types and Lifecycle (Gmail)

Token/credential types:
- Authorization code: short-lived code used during OAuth callback exchange.
- Refresh token: long-lived secret used to mint access tokens.
- Access token: short-lived bearer token for Gmail API calls.

Lifecycle:
1. Connect (OAuth consent):
- Receive authorization code and exchange with provider.
- Persist refresh token using encrypted storage posture.
2. Use:
- Refresh access token as needed.
- Use access token to call Gmail for message fetch/draft operations.
- Generate draft (v1 never auto-sends).
3. Disconnect:
- Revoke provider token if possible.
- Disable mailbox connection and remove local token material.
4. Re-auth required scenarios:
- Provider consent revoked
- Refresh token invalidated/rotated
- Scope/permission changes
- Security incident or forced reconnect policy

## D) Storage Posture (Conceptual, Frozen Requirements)

Refresh token requirements:
- Refresh tokens MUST be encrypted at rest.
- Envelope encryption model is REQUIRED conceptually:
- Master key in KMS/secret manager (key-encryption key).
- Per-tenant or per-connection data key for token encryption.
- Stored token record MUST retain key identifier/version (`kid`) for rotation tracking.

Access token requirements:
- Access tokens SHOULD NOT be persistently stored.
- If temporarily cached, cache MUST be short TTL (minutes), encrypted/in-memory preferred, and scoped to `tenant_id + mailbox_connection_id`.

Conceptual token record schema (no implementation in this step):
- `tenant_id`
- `mailbox_connection_id`
- `provider`
- `token_ciphertext`
- `token_kid` / key version
- `created_at`
- `updated_at`
- `last_used_at`
- `revoked_at`
- `status`

Tenant isolation alignment:
- Token records are tenant-scoped resources and MUST follow the tenant boundary model in Step 11.2.
- RLS tenant scoping MUST apply before GA; token data must never be readable cross-tenant.

## E) Access Controls + Service Boundaries

- Only trusted API/worker paths that perform provider calls may decrypt/use tokens.
- Admin UI MUST never display raw tokens; it may show connection status and last-sync/health states only.
- Support operations MUST not expose token material; allowed operator actions are reconnect/disconnect and status diagnostics.
- Non-provider services should not have token decryption capability by default.

## F) Rotation, Revocation, and Disconnect Behavior

Required operations:
- Disconnect mailbox:
- Attempt provider revoke when available.
- Mark token/connection revoked locally.
- Delete token ciphertext material.
- Stop related processing and purge token caches.
- Key rotation:
- Re-encrypt stored ciphertext using new key version.
- Persist/update `kid` for traceability.
- Compromise response:
- Immediate local disable + revoke attempt.
- Force reconnect before further processing.

Failure handling:
- If provider revoke fails, local disable still MUST occur and reconnect is required.
- If refresh fails with `invalid_grant`, mark connection broken, stop token use, and surface reconnect-required status to admin.

## G) Logging, Redaction, and Incident Safety

Never log:
- Refresh tokens
- Access tokens
- Authorization codes
- OAuth client secrets
- Encryption keys or raw key material

Allowed logging:
- Token event metadata only (for example `tenant_id`, `mailbox_connection_id`, provider, status, timestamps, normalized error code).

Error handling:
- Provider errors MUST be sanitized before logging or returning to clients.
- Any message that may contain secret-like payloads must be redacted.

Observability metrics (allowed):
- Token refresh success rate
- `invalid_grant` rate
- Reconnect-required rate
- Time-to-draft after refresh

## H) Other Secrets Posture (Policy)

OpenAI API key:
- Stored in environment/secret manager.
- Never stored in tenant DB records.
- Rotated on policy schedule or incident.

DB/Redis credentials:
- Stored in secret manager or secured runtime environment.
- Rotated periodically.
- Least-privilege account model required.

Webhook verification secrets (future):
- Per-tenant where applicable.
- Rotation capability required.
- Audited lifecycle events required.

Admin session secrets/cookies:
- Cookie/session signing secrets handled as sensitive system secrets.
- Never logged; rotation plan required.

## I) Audit Events (Required)

Required conceptual events:
- `mailbox.connected`
- `mailbox.disconnected`
- `token.refresh.succeeded`
- `token.refresh.failed`
- `token.revoked`
- `token.reencrypted`
- `secret.rotated`

Audit event requirements:
- Include `tenant_id` and `mailbox_connection_id` where applicable.
- Include actor type, timestamp, provider/context metadata, and outcome.
- Never include token values, auth codes, client secrets, or key material.

## J) Open Questions / Follow-Ups

- KMS/secret-manager implementation choice and integration details (implementation step later, no stack change decided here).
- Whether shared mailbox token models (operator-level vs user-level grants) are supported in future versions.
- Whether customer-managed keys (CMK/BYOK) are offered for enterprise tiers later.

## Cross-References

- Data minimization baseline: `docs/phases/phase-11-security/data-map-classification-v1.md` (Step 11.1)
- Tenant boundary requirements: `docs/phases/phase-11-security/tenant-isolation-requirements-v1.md` (Step 11.2)
