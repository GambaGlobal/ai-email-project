import type { PoolClient } from "pg";
import { queryOne } from "./db.js";

export type UpsertGmailConnectionInput = {
  tenantId: string;
  accessTokenCiphertext: string;
  accessTokenIv: string;
  accessTokenTag: string;
  refreshTokenCiphertext: string | null;
  refreshTokenIv: string | null;
  refreshTokenTag: string | null;
  tokenExpiresAt: string | null;
};

export type GmailConnectionRow = {
  tenant_id: string;
  provider: "gmail";
  status: string;
  connected_at: string | Date | null;
  last_verified_at: string | Date | null;
  updated_at: string | Date | null;
};

export async function upsertGmailConnection(
  client: PoolClient,
  input: UpsertGmailConnectionInput
): Promise<GmailConnectionRow> {
  const row = (await queryOne(
    client,
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
      RETURNING
        tenant_id::text AS tenant_id,
        provider,
        status,
        connected_at,
        last_verified_at,
        updated_at
    `,
    [
      input.tenantId,
      input.accessTokenCiphertext,
      input.accessTokenIv,
      input.accessTokenTag,
      input.refreshTokenCiphertext,
      input.refreshTokenIv,
      input.refreshTokenTag,
      input.tokenExpiresAt
    ]
  )) as GmailConnectionRow | null;

  if (!row) {
    throw new Error("gmail connection upsert failed");
  }

  return row;
}

export async function getGmailConnection(
  client: PoolClient,
  tenantId: string
): Promise<GmailConnectionRow | null> {
  return (await queryOne(
    client,
    `
      SELECT
        tenant_id::text AS tenant_id,
        provider,
        status,
        connected_at,
        last_verified_at,
        updated_at
      FROM mail_provider_connections
      WHERE tenant_id = $1
        AND provider = 'gmail'
      LIMIT 1
    `,
    [tenantId]
  )) as GmailConnectionRow | null;
}
