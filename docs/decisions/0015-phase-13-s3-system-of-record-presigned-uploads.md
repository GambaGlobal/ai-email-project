# DR-0015: Phase 13 S3 System-of-Record + Presigned Browser Uploads

## Status
Accepted

## Date
2026-02-15

## Context
- Phase 13 requires reliable raw document upload/download with strict tenant isolation.
- Browser/device compatibility matters for operators using varied engines (including mobile Safari).
- Product privacy stance requires raw customer documents to remain in our storage boundary.

## Decision
1. Use S3-compatible object storage as the system of record for raw uploads and extracted artifacts.
2. Use presigned POST for browser uploads (multipart/form-data compatibility across browser engines).
3. Keep tenant isolation at both layers:
   - DB ownership checks for tenant/doc/version before issuing signatures.
   - Deterministic tenant-scoped object keys:
     - `tenants/{tenantId}/docs/{docId}/versions/{versionId}/raw/{safeFilename}`
4. Use presigned GET for short-lived raw file downloads with tenant ownership checks.
5. Finalize uploads with S3 `HEAD` verification and persist metadata on `doc_versions`:
   - `raw_file_key`, `source_filename`, `mime_type`, `bytes`, `sha256`

## Non-Goals
- Storing raw documents in OpenAI Files/Vector Stores.
- Multipart upload orchestration or IaC/IAM provisioning in this step.

## Consequences
- Upload flow becomes two-step (`presign` -> client upload -> `finalize`) for stronger control.
- Requires bucket CORS/security posture setup per environment.

## References
- `docs/decisions/0001-tech-stack.md`
- `docs/decisions/0014-phase-13-doc-model-versioning-states.md`
- `docs/dev/s3-doc-storage.md`
