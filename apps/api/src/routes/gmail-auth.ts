import type { FastifyPluginAsync } from "fastify";
import { consumeOAuthState, issueOAuthState } from "../lib/oauth-state.js";
import { resolveTenantIdForOAuthStart } from "../lib/tenant.js";
import { withTenantClient } from "../lib/db.js";
import { encryptToken } from "../lib/token-crypto.js";
import { enqueueMailboxSync, mailboxSyncJobId } from "../lib/mailbox-sync-queue.js";

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

type GmailProfileResponse = {
  emailAddress?: string;
  historyId?: string;
};

const DIGITS_ONLY = /^[0-9]+$/;

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

      let mailboxEmail: string;
      let historyId = "0";
      try {
        const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          method: "GET",
          headers: {
            authorization: `Bearer ${tokenPayload.access_token}`
          }
        });

        const profilePayload = (await profileResponse.json()) as GmailProfileResponse;
        if (!profileResponse.ok || !profilePayload.emailAddress) {
          request.log.error(
            { profilePayload, statusCode: profileResponse.status },
            "Gmail profile lookup failed"
          );
          return reply.code(502).send({ error: "Unable to complete Gmail authentication" });
        }

        mailboxEmail = profilePayload.emailAddress.toLowerCase();
        historyId =
          typeof profilePayload.historyId === "string" && DIGITS_ONLY.test(profilePayload.historyId)
            ? profilePayload.historyId
            : "0";
      } catch (error) {
        request.log.error({ error }, "Gmail profile lookup request failed");
        return reply.code(502).send({ error: "Unable to complete Gmail authentication" });
      }

      let provisioned: { mailboxId: string; connectionId: string };
      try {
        provisioned = await withTenantClient(stateRecord.tenantId, async (client) => {
          const connectionResult = await client.query(
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
              RETURNING tenant_id::text AS tenant_id, provider
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

          const mailboxResult = await client.query(
            `
              WITH matched AS (
                SELECT id
                FROM mailboxes
                WHERE tenant_id = $1
                  AND provider = 'gmail'
                  AND lower(email_address) = lower($2)
                LIMIT 1
              ),
              updated AS (
                UPDATE mailboxes
                SET
                  address = $2,
                  provider_mailbox_id = $3,
                  email_address = $2,
                  status = 'connected',
                  updated_at = now()
                WHERE id IN (SELECT id FROM matched)
                RETURNING id::text AS mailbox_id
              ),
              inserted AS (
                INSERT INTO mailboxes (
                  tenant_id,
                  provider,
                  address,
                  provider_mailbox_id,
                  email_address,
                  status,
                  updated_at
                )
                SELECT $1, 'gmail', $2, $3, $2, 'connected', now()
                WHERE NOT EXISTS (SELECT 1 FROM updated)
                ON CONFLICT (tenant_id, provider, address)
                DO UPDATE SET
                  provider_mailbox_id = EXCLUDED.provider_mailbox_id,
                  email_address = EXCLUDED.email_address,
                  status = 'connected',
                  updated_at = now()
                RETURNING id::text AS mailbox_id
              )
              SELECT mailbox_id FROM updated
              UNION ALL
              SELECT mailbox_id FROM inserted
              LIMIT 1
            `,
            [stateRecord.tenantId, mailboxEmail, mailboxEmail]
          );

          const mailboxId = String(mailboxResult.rows[0]?.mailbox_id ?? "");
          if (!mailboxId) {
            throw new Error("mailbox upsert failed");
          }

          await client.query(
            `
              INSERT INTO mailbox_sync_state (
                tenant_id,
                mailbox_id,
                provider,
                last_history_id,
                pending_max_history_id,
                pending_updated_at,
                updated_at
              )
              VALUES ($1, $2, 'gmail', $3::numeric, $3::numeric, now(), now())
              ON CONFLICT (tenant_id, mailbox_id, provider)
              DO UPDATE SET
                pending_max_history_id = GREATEST(
                  mailbox_sync_state.pending_max_history_id,
                  EXCLUDED.pending_max_history_id
                ),
                updated_at = now()
            `,
            [stateRecord.tenantId, mailboxId, historyId]
          );

          const connectionRow = connectionResult.rows[0] as
            | { tenant_id?: string; provider?: string }
            | undefined;
          const connectionId = `${connectionRow?.tenant_id ?? stateRecord.tenantId}:${connectionRow?.provider ?? "gmail"}`;

          return {
            mailboxId,
            connectionId
          };
        });
      } catch (error) {
        request.log.error({ error }, "Failed to provision Gmail mailbox on OAuth callback");
        return reply.code(500).send({ error: "Unable to save Gmail connection" });
      }

      try {
        const jobId = mailboxSyncJobId("gmail", provisioned.mailboxId);
        await enqueueMailboxSync(
          {
            tenantId: stateRecord.tenantId,
            mailboxId: provisioned.mailboxId,
            provider: "gmail"
          },
          jobId
        );
      } catch (error) {
        request.log.error({ error }, "Failed to enqueue initial mailbox sync");
        return reply.code(500).send({ error: "Unable to initialize mailbox sync" });
      }

      request.log.info(
        {
          tenant_id: stateRecord.tenantId,
          mailbox_id: provisioned.mailboxId,
          email: mailboxEmail,
          connection_id: provisioned.connectionId
        },
        "gmail connect provisioned mailbox"
      );

      const adminBaseUrl = process.env.ADMIN_BASE_URL ?? "http://localhost:3000";
      const redirectUrl = new URL(stateRecord.returnPath, adminBaseUrl);
      redirectUrl.searchParams.set("connected", "gmail");

      return reply.redirect(302, redirectUrl.toString());
    }
  );
};

export default gmailAuthRoutes;
