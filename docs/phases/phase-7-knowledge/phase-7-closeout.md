# Phase 7 Closeout — Knowledge Ingestion & Retrieval (Build + Trust)

## Phase goal
Define a deterministic, trust-first knowledge ingestion and retrieval contract so Gmail drafts are grounded in operator evidence and ambiguous cases route safely to human review.

## What we defined in Phase 7 (summary)
- `docs/phases/phase-7-knowledge/knowledge-taxonomy-v1.md`: freezes v1 knowledge definition, supported doc types, taxonomy, precedence, tie-breakers, and metadata requirements.
- `docs/phases/phase-7-knowledge/ingestion-pipeline-v1.md`: freezes ingestion lifecycle, artifacts, idempotency keys, and failure taxonomy.
- `docs/phases/phase-7-knowledge/chunking-and-citations-v1.md`: freezes deterministic chunking and operator-visible citation scheme.
- `docs/phases/phase-7-knowledge/retrieval-and-ranking-v1.md`: freezes hybrid retrieval defaults, tiered precedence ranking, thresholds, and evidence pack constraints.
- `docs/phases/phase-7-knowledge/conflict-and-staleness-handling-v1.md`: freezes deterministic conflict/staleness escalation matrix and reason codes.
- `docs/phases/phase-7-knowledge/unknown-and-evaluation-v1.md`: freezes unknown rules, safe drafting templates, telemetry plan, and evaluation targets.

## Evidence gate (Phase 7 success definition)
- Retrieval quality: `Recall@10 >= 0.85` on eval set with at least `50` emails.
- Grounding quality: policy citation coverage `>= 0.95`.
- Safety quality: invented policy incidents `= 0`.
- Claim discipline: unsupported claim rate `<= 0.05`.
- Escalation correctness: sensitive-topic routing correctness `>= 0.95`.
- Latency placeholder (staging): p95 retrieval `< 1.5s` excluding generation.

How measured:
- Run offline eval harness against tenant-specific labeled set.
- Compute retrieval, groundedness, escalation, and safety metrics from evaluation outputs plus telemetry counters.

Data required:
- Labeled email/evidence dataset (50+ examples to start).
- Retrieval outputs (candidate lists, scores, selected evidence pack).
- Draft outputs with policy-like sentence and citation annotations.
- Escalation outcomes with reason codes.

## Milestone map (Phase 8 build)
1. Operator doc upload + metadata UI.
Why it matters: operators can create a usable, auditable knowledge base.
2. Ingestion worker pipeline (parse/chunk/embed/index) with idempotency.
Why it matters: knowledge processing is reliable and retry-safe.
3. Retrieval service + evidence pack builder.
Why it matters: draft grounding is deterministic and inspectable.
4. Draft generation integration with citations + safety gates.
Why it matters: generated replies cannot invent policy silently.
5. Needs review UX + reason code visibility.
Why it matters: operator trust increases when escalation is explainable.
6. Evaluation harness + dashboards.
Why it matters: evidence gate can be measured continuously.
7. Optional multilingual support.
Why it matters: expands addressable operator base without breaking trust controls.

## Step backlog (Phase 8 execution)
### 8.1 Define schema + migration plan for docs/chunks/embeddings metadata
Goal: freeze implementation-ready data layer shape for knowledge artifacts and retrieval filters.
Acceptance checks: schema spec includes tenant scoping, doc version lineage, chunk locators, embedding model versioning, and supersedes linkage.
Dependencies: Phase 7 specs.

### 8.2 Admin UI for document upload and required metadata
Goal: let operators upload docs and set category/priority/effective_date/last_reviewed_at.
Acceptance checks: uploaded doc requires metadata before submission; values persist and display correctly.
Dependencies: 8.1.

### 8.3 Storage wiring for S3 + signed URL strategy + tenant prefix enforcement
Goal: store raw and extracted artifacts with strict tenant path isolation.
Acceptance checks: uploads land under tenant-prefixed keys; access is scoped and auditable.
Dependencies: 8.1.

### 8.4 Worker parse stage + scan detection to needs_attention
Goal: extract normalized text and route scanned PDFs to `needs_attention` deterministically.
Acceptance checks: digital-text PDF parses successfully; scan-like PDF routes with `PARSE_EMPTY_TEXT_SCAN_DETECTED`.
Dependencies: 8.3.

### 8.5 Worker chunk stage with stable chunk_id generation
Goal: apply default chunking profile and stable source locators.
Acceptance checks: rerun on same doc_version yields identical chunk count, chunk_id sequence, and locators.
Dependencies: 8.4.

### 8.6 Worker embed stage via OpenAI wrapper with retries/backoff
Goal: generate embeddings idempotently using configured model id.
Acceptance checks: retries do not duplicate embeddings; terminal failures capture error code and redacted summary.
Dependencies: 8.5.

### 8.7 DB retrieval indexes: pgvector + lexical + tenant-scoped filters
Goal: enable fast hybrid retrieval and precedence-aware filtering.
Acceptance checks: vector and lexical queries return tenant-scoped results; superseded versions excluded by default.
Dependencies: 8.1, 8.6.

### 8.8 Retrieval endpoint/service with hybrid candidate union + tiered ranking + diversity
Goal: produce ranked candidates respecting precedence/staleness semantics.
Acceptance checks: `K_v=24`, `K_l=16`, cap `40` enforced; marketing never outranks policy for policy-like claims.
Dependencies: 8.7.

### 8.9 Evidence pack + citation payload builder
Goal: return bounded evidence packs with citation-ready objects.
Acceptance checks: pack size within `4-10`; each selected chunk includes doc title/category/source locator/chunk id/score.
Dependencies: 8.8.

### 8.10 Draft generation integration with policy-like citation enforcement
Goal: block policy-like statements lacking citations and route via escalation outcomes.
Acceptance checks: policy-like sentence without citation is prevented; outputs follow `OK/ASK/REVIEW/UNKNOWN` rules.
Dependencies: 8.9.

### 8.11 Needs review UX with reason codes and evidence display
Goal: give operators clear escalation reasons and supporting evidence.
Acceptance checks: every escalated draft shows reason code(s) and evidence locators (except explicit no-evidence case).
Dependencies: 8.10.

### 8.12 Offline evaluation harness runner
Goal: run labeled eval set and compute retrieval/groundedness/escalation metrics.
Acceptance checks: harness outputs Recall@10, Precision@10, citation coverage, unsupported rate, escalation correctness.
Dependencies: 8.9, 8.10.

### 8.13 Dashboards + alerts for grounding/safety KPIs
Goal: monitor quality and detect regressions in production-like environments.
Acceptance checks: dashboards show core metrics; alerts trigger on invented policy incidents and unsupported-claim spikes.
Dependencies: 8.12.

### 8.14 Operator doc hygiene tooling (staleness warnings + review workflow)
Goal: reduce stale-only evidence frequency through operator workflows.
Acceptance checks: stale docs are flagged; operators can filter/schedule review and update last_reviewed_at.
Dependencies: 8.2, 8.11.

## Which step to run first
Next recommended Step: 8.1
