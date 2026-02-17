# Retrieval Service (Step 13.5)

## Endpoint
- `POST /v1/retrieval/query`
- Tenant context is required via `x-tenant-id` header.

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
  "query": "What is your refund policy?",
  "reason": "canonical_qa",
  "top_sources": [
    {
      "source_type": "canonical_qa",
      "source_id": "f82ce5bd-9393-44ca-a36d-7ce28f994df8",
      "tenant_id": "11111111-1111-4111-8111-111111111111",
      "doc_id": null,
      "version_id": null,
      "chunk_index": null,
      "start_char": null,
      "end_char": null,
      "content_sha256": "2df5f4f2f7fdbcb17e3ef4383fceec953cbfd12f8f3c0d6737f7a26e08d5f7b6",
      "content": "Refunds are available up to 14 days before trip departure...",
      "excerpt": "Refunds are available up to 14 days before trip departure...",
      "score": 1
    }
  ]
}
```
