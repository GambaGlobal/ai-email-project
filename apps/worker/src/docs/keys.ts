export function buildExtractedTextKey(input: {
  tenantId: string;
  docId: string;
  versionId: string;
}): string {
  return `tenants/${input.tenantId}/docs/${input.docId}/versions/${input.versionId}/extracted/text.txt`;
}

export function buildExtractedMetadataKey(input: {
  tenantId: string;
  docId: string;
  versionId: string;
}): string {
  return `tenants/${input.tenantId}/docs/${input.docId}/versions/${input.versionId}/extracted/metadata.json`;
}
