# OAuth Callback Bridge Service

Purpose: Public OAuth bridge that forwards Gmail start/callback requests to private API with Cloud Run ID token auth.

Routes:
- `GET /v1/auth/gmail/start`
- `GET /v1/auth/gmail/callback`

Manual verification checklist:
1. Open `<BRIDGE_BASE_URL>/v1/auth/gmail/start?tenant_id=<TENANT_ID>&return_to=/onboarding`.
2. Confirm browser redirects to `https://accounts.google.com/...`.
3. Complete consent and confirm redirect returns to `<BRIDGE_BASE_URL>/v1/auth/gmail/callback`.
4. Confirm final redirect lands on Admin onboarding with `?gmail=connected` on success.
5. Confirm API remains private by checking anonymous `GET <API_BASE_URL>/health` returns `403`.
