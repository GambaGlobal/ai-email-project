# Retrieval Service (Step 13.5)

## Endpoint
- `POST /v1/retrieval/query`
- Tenant context is required via `x-tenant-id` header.
- Response shape is `CitationPayload` (`version`, `query`, `reason`, `sources[]`).

## Canonical-First Rule
1. Normalize query text (lowercase, collapse whitespace, tokenize).
2. Search `canonical_qa` entries scoped to tenant with `status='APPROVED'`.
3. Deterministic lexical threshold: every normalized query token must appear in `canonical_qa.question`.
4. If one or more canonical entries match:
   - return canonical matches first (`reason: "canonical_qa"`)
   - fill remaining `topK` slots from `doc_chunks` vector retrieval
5. If no canonical entry matches:
   - return `doc_chunks` only (`reason: "doc_chunks"`)

## Doc Chunks Retrieval
- Query embedding model defaults to `text-embedding-3-small`.
- pgvector cosine search on `doc_chunks.embedding` (`<=>` operator).
- Only chunks from `doc_versions.state='ACTIVE'` are eligible.
- Deterministic ordering: distance ASC, `chunk_index` ASC, chunk `id` ASC.

## topK Defaults
- Default: `5`
- Max: `20`

## Payload Defaults
- Responses are excerpt-only by default.
- `excerpt` is always present and capped to `800` chars by default.
- `content`/`answer` fields are omitted unless explicitly enabled for debugging.

## Debugging
- Set `RETRIEVAL_INCLUDE_CONTENT=true` to include full source `content` in response payloads.
- Optionally set `RETRIEVAL_EXCERPT_MAX_CHARS=1200` (clamped `100..5000`) to increase excerpt size.
- Production-safe default: leave both vars unset.

## Example Request
```bash
curl -X POST http://localhost:3001/v1/retrieval/query \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: 11111111-1111-4111-8111-111111111111" \
  -d '{"query":"What is your refund policy?","topK":5}'
```

## Example Response
```json
{
  "version": "v1",
  "query": "What is your refund policy?",
  "reason": "canonical_qa",
  "sources": [
    {
      "source_type": "canonical_qa",
      "canonical_id": "f82ce5bd-9393-44ca-a36d-7ce28f994df8",
      "tenant_id": "11111111-1111-4111-8111-111111111111",
      "doc_id": null,
      "version_id": null,
      "question": "What is your refund policy?",
      "status": "APPROVED",
      "excerpt": "Refunds are available up to 14 days before trip departure...",
      "score": 1
    }
  ]
}
```
