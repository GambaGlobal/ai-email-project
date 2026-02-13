export const KILL_SWITCH_DOCS_INGESTION = "docs_ingestion";
export const ENV_DOCS_INGESTION_DISABLED = "DOCS_INGESTION_DISABLED";

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
