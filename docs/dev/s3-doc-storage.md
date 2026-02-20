# S3 Doc Storage (Cloud-Only)

This project stores raw customer documents in S3-compatible object storage as the system of record.

## Required Env Vars
- `S3_BUCKET` (or `S3_BUCKET_DOCS`)
- `S3_REGION`
- Optional:
  - `S3_ENDPOINT` (for non-AWS S3-compatible providers)
  - `S3_FORCE_PATH_STYLE` (`1` or `true` when provider requires path-style)
  - `S3_PRESIGN_TTL_SECONDS` (default `300`)
  - `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (set both or neither; IAM/role auth is supported)

## Browser Upload/Download Flow
- Upload: API returns a presigned POST (`url`, `fields`, `key`) for browser multipart/form-data uploads.
- Finalize: API verifies object existence via S3 `HEAD` and persists key + metadata to `doc_versions`.
- Download: API returns a short-lived presigned GET URL for tenant-owned objects only.

## Ingestion Artifacts (Step 13.3)
Worker job `doc.ingest.v1` reads `doc_versions.raw_file_key`, extracts deterministic text, and writes:
- Extracted text:
  - `tenants/{tenantId}/docs/{docId}/versions/{versionId}/extracted/text.txt`
- Extract metadata:
  - `tenants/{tenantId}/docs/{docId}/versions/{versionId}/extracted/metadata.json`

`doc_versions.extracted_text_key` stores the `text.txt` key.

## Indexing Artifacts (Step 13.4)
Worker job `doc.index.v1` reads `doc_versions.extracted_text_key`, chunks deterministically, embeds via OpenAI embeddings API, and stores vectors in Postgres `doc_chunks`.

Chunking defaults:
- Approx target size: 800 tokens (`~3200` chars)
- Overlap: 100 tokens (`~400` chars)
- Prefer paragraph boundaries; fallback to fixed char windows

Each row in `doc_chunks` stores provenance:
- `tenant_id`, `doc_id`, `version_id`, `chunk_index`
- `start_char`, `end_char`
- `content_sha256`
- `embedding` (`vector(1536)`)

On successful indexing, `doc_versions.state` is promoted to `ACTIVE` and prior active version(s) for the same doc are archived.

Supported v1 types:
- PDF
- DOCX
- TXT / MD
- HTML

No OCR is included in v1.

### Enqueue Ingestion (Dev/Stage)
Use the minimal enqueue script:

```bash
REDIS_URL="redis://127.0.0.1:6379" \
TENANT_ID="<tenant-uuid>" \
DOC_ID="<doc-uuid>" \
VERSION_ID="<version-uuid>" \
pnpm -w doc:ingest:enqueue
```

### Enqueue Indexing (Dev/Stage)
Use the minimal enqueue script:

```bash
REDIS_URL="redis://127.0.0.1:6379" \
TENANT_ID="<tenant-uuid>" \
DOC_ID="<doc-uuid>" \
VERSION_ID="<version-uuid>" \
pnpm -w doc:index:enqueue
```

## Tenant Isolation
- Keys are tenant/doc/version scoped:
  - `tenants/{tenantId}/docs/{docId}/versions/{versionId}/raw/{safeFilename}`
- API enforces tenant ownership in DB queries before issuing presigns.
- Finalize rejects keys that do not match expected tenant/doc/version key structure.

## Recommended Bucket Security
- Enable Block Public Access for the bucket/account.
- Default encryption at rest:
  - `SSE-S3` minimum, `SSE-KMS` recommended.
- Keep object ACLs private (no public-read ACLs).
- Restrict IAM principals to least privilege (`s3:GetObject`, `s3:PutObject`, `s3:HeadObject`, `s3:DeleteObject` as needed).

## Sample CORS Policy
Replace origins for your local/preview/admin hosts:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "POST", "HEAD"],
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://<preview-domain>",
      "https://<admin-domain>"
    ],
    "ExposeHeaders": ["ETag", "x-amz-request-id", "x-amz-id-2"],
    "MaxAgeSeconds": 3000
  }
]
```

## Privacy Stance
- Raw customer docs remain in S3-compatible storage controlled by this system.
- Raw docs are not stored in OpenAI Files or Vector Stores.
