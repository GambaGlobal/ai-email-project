import type { FastifyPluginAsync } from "fastify";
import { consumeOAuthState, issueOAuthState } from "../lib/oauth-state.js";
import { resolveTenantIdForOAuthStart } from "../lib/tenant.js";
import { withTenantClient } from "../lib/db.js";
import { encryptToken } from "../lib/token-crypto.js";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose"
] as const;

// Expected env:
// GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URL, ADMIN_BASE_URL.
// TOKEN_ENCRYPTION_KEY is consumed in token-crypto.ts when persisting OAuth tokens.
type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

const gmailAuthRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { tenant_id?: string; return_to?: string } }>(
    "/v1/auth/gmail/start",
    async (request, reply) => {
      const tenantId = resolveTenantIdForOAuthStart(request);
      if (!tenantId) {
        return reply
          .code(400)
          .send({ error: "Missing tenant context. Provide tenant_id or x-tenant-id." });
      }

      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URL;

      if (!clientId || !redirectUri) {
        request.log.error("Missing Google OAuth env configuration");
        return reply.code(500).send({ error: "OAuth configuration is incomplete" });
      }

      const returnPath =
        typeof request.query.return_to === "string" && request.query.return_to.startsWith("/")
          ? request.query.return_to
          : "/onboarding";

      let state: string;
      try {
        state = await issueOAuthState({
          tenantId,
          provider: "gmail",
          returnPath
        });
      } catch (error) {
        request.log.error({ error }, "Failed to persist OAuth state in Redis");
        return reply.code(500).send({ error: "Unable to start Gmail authentication" });
      }
      const googleOAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");

      googleOAuthUrl.searchParams.set("client_id", clientId);
      googleOAuthUrl.searchParams.set("redirect_uri", redirectUri);
      googleOAuthUrl.searchParams.set("response_type", "code");
      googleOAuthUrl.searchParams.set("scope", GMAIL_SCOPES.join(" "));
      googleOAuthUrl.searchParams.set("access_type", "offline");
      googleOAuthUrl.searchParams.set("prompt", "consent");
      googleOAuthUrl.searchParams.set("state", state);

      return reply.redirect(302, googleOAuthUrl.toString());
    }
  );

  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/v1/auth/gmail/callback",
    async (request, reply) => {
      const { code, state } = request.query;

      if (!code || !state) {
        return reply.code(400).send({ error: "Missing OAuth code or state" });
      }

      const stateRecord = await consumeOAuthState("gmail", state);
      if (!stateRecord) {
        return reply.code(400).send({ error: "Invalid or expired OAuth state" });
      }

      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URL;

      if (!clientId || !clientSecret || !redirectUri) {
        request.log.error("Missing Google OAuth env configuration at callback");
        return reply.code(500).send({ error: "OAuth configuration is incomplete" });
      }

      const tokenRequestBody = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      });

      let tokenPayload: GoogleTokenResponse;
      try {
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded"
          },
          body: tokenRequestBody.toString()
        });

        tokenPayload = (await tokenResponse.json()) as GoogleTokenResponse;

        if (!tokenResponse.ok || !tokenPayload.access_token) {
          request.log.error(
            { tokenPayload, statusCode: tokenResponse.status },
            "Google token exchange failed"
          );
          return reply.code(502).send({ error: "Unable to complete Gmail authentication" });
        }
      } catch (error) {
        request.log.error({ error }, "Google token exchange request failed");
        return reply.code(502).send({ error: "Unable to complete Gmail authentication" });
      }

      const encryptedAccessToken = encryptToken(tokenPayload.access_token);
      const encryptedRefreshToken = tokenPayload.refresh_token
        ? encryptToken(tokenPayload.refresh_token)
        : null;

      const expiresAt =
        typeof tokenPayload.expires_in === "number"
          ? new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString()
          : null;

      try {
        await withTenantClient(stateRecord.tenantId, async (client) => {
          await client.query(
            `
              INSERT INTO mail_provider_connections (
                tenant_id,
                provider,
                status,
                access_token_ciphertext,
                access_token_iv,
                access_token_tag,
                refresh_token_ciphertext,
                refresh_token_iv,
                refresh_token_tag,
                token_expires_at,
                connected_at,
                last_verified_at,
                updated_at
              )
              VALUES (
                $1,
                'gmail',
                'connected',
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                now(),
                now(),
                now()
              )
              ON CONFLICT (tenant_id, provider)
              DO UPDATE SET
                status = 'connected',
                access_token_ciphertext = EXCLUDED.access_token_ciphertext,
                access_token_iv = EXCLUDED.access_token_iv,
                access_token_tag = EXCLUDED.access_token_tag,
                refresh_token_ciphertext = COALESCE(
                  EXCLUDED.refresh_token_ciphertext,
                  mail_provider_connections.refresh_token_ciphertext
                ),
                refresh_token_iv = COALESCE(
                  EXCLUDED.refresh_token_iv,
                  mail_provider_connections.refresh_token_iv
                ),
                refresh_token_tag = COALESCE(
                  EXCLUDED.refresh_token_tag,
                  mail_provider_connections.refresh_token_tag
                ),
                token_expires_at = EXCLUDED.token_expires_at,
                connected_at = COALESCE(mail_provider_connections.connected_at, now()),
                last_verified_at = now(),
                updated_at = now()
            `,
            [
              stateRecord.tenantId,
              encryptedAccessToken.ciphertext,
              encryptedAccessToken.iv,
              encryptedAccessToken.tag,
              encryptedRefreshToken?.ciphertext ?? null,
              encryptedRefreshToken?.iv ?? null,
              encryptedRefreshToken?.tag ?? null,
              expiresAt
            ]
          );
        });
      } catch (error) {
        request.log.error({ error }, "Failed to persist Gmail OAuth connection");
        return reply.code(500).send({ error: "Unable to save Gmail connection" });
      }

      const adminBaseUrl = process.env.ADMIN_BASE_URL ?? "http://localhost:3000";
      const redirectUrl = new URL(stateRecord.returnPath, adminBaseUrl);
      redirectUrl.searchParams.set("connected", "gmail");

      return reply.redirect(302, redirectUrl.toString());
    }
  );
};

export default gmailAuthRoutes;
