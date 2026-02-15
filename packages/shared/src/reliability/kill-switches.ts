export const KILL_SWITCH_DOCS_INGESTION = "docs_ingestion";
export const ENV_DOCS_INGESTION_DISABLED = "DOCS_INGESTION_DISABLED";
export const KILL_SWITCH_MAIL_NOTIFICATIONS = "mail_notifications";
export const KILL_SWITCH_MAILBOX_SYNC = "mailbox_sync";
export const ENV_MAIL_NOTIFICATIONS_DISABLED = "MAIL_NOTIFICATIONS_DISABLED";
export const ENV_MAILBOX_SYNC_DISABLED = "MAILBOX_SYNC_DISABLED";

export function isTruthyEnv(value?: string): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isGlobalDocsIngestionDisabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isTruthyEnv(env[ENV_DOCS_INGESTION_DISABLED]);
}

export function isGlobalMailNotificationsDisabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isTruthyEnv(env[ENV_MAIL_NOTIFICATIONS_DISABLED]);
}

export function isGlobalMailboxSyncDisabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isTruthyEnv(env[ENV_MAILBOX_SYNC_DISABLED]);
}
