# DR-0016: Phase 13 Doc Ingestion Extraction v1

## Status
Accepted

## Date
2026-02-15

## Context
- We need deterministic extraction from raw S3 doc versions before chunking/indexing.
- Ingestion must be retry-safe, observable, and tenant-isolated.
- Step 13.3 should not introduce OCR or retrieval behavior.

## Decision
1. Add worker job `doc.ingest.v1` (BullMQ queue `docs_ingestion`) with payload:
   - `tenantId`, `docId`, `versionId`, `correlationId`
2. v1 supported parsers/types:
   - PDF (`pdf-parse`)
   - DOCX (`mammoth`)
   - TXT/MD (plain text)
   - HTML (`html-to-text`)
3. Deterministic extracted artifacts in S3:
   - `.../extracted/text.txt`
   - `.../extracted/metadata.json`
4. State progression:
   - start: `PROCESSING`
   - success: remain `PROCESSING` with `extracted_text_key` set
   - failure: `ERROR` with `error_code` + `error_message`
5. Non-goal:
   - no OpenAI Files/Vector Stores for raw documents
   - no OCR in v1

## Consequences
- Re-runs overwrite deterministic artifact keys safely (idempotent).
- `ACTIVE` promotion remains deferred to indexing step (13.4).

## References
- `docs/decisions/0014-phase-13-doc-model-versioning-states.md`
- `docs/decisions/0015-phase-13-s3-system-of-record-presigned-uploads.md`
- `docs/dev/s3-doc-storage.md`
