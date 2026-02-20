# Citation Payload Contract (v1)

Step 13.6 freezes the citation payload schema used between retrieval, generation, and audit persistence.

## Contract Location
- Shared types: `packages/shared/src/docs/citations.ts`
- Constant: `CITATION_CONTRACT_VERSION = "v1"`

## Payload Shape
```ts
type CitationPayload = {
  version: "v1";
  query: string;
  reason: "canonical_qa" | "doc_chunks";
  sources: CitationSource[];
};
```

`CitationSource` is a union:
- `doc_chunk`: includes `tenant_id`, `chunk_id`, `doc_id`, `version_id`, `chunk_index`, `start_char`, `end_char`, `content_sha256`, `excerpt`, `score` (+ optional `content` when debug flag is on).
- `canonical_qa`: includes `tenant_id`, `canonical_id`, optional doc/version refs, `question`, `status`, `excerpt`, `score` (+ optional `answer` when debug flag is on).

## Runtime Use
1. `POST /v1/retrieval/query` returns `CitationPayload`.
2. `POST /v1/generate/preview` consumes that payload and sends sources to OpenAI Responses as structured JSON.
3. API writes one `generation_audits` row per preview request with:
   - `citation_contract_version`
   - `reason`
   - `query`
   - `sources` (`jsonb`, full payload)
   - optional `correlation_id`

## Debug Flags
- `RETRIEVAL_INCLUDE_CONTENT=true` includes `content`/`answer` fields.
- `RETRIEVAL_EXCERPT_MAX_CHARS` controls excerpt cap (clamped `100..5000`, default `800`).
