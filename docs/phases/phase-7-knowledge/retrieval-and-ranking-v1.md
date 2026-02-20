# Retrieval & Ranking v1 (Trust-First Grounding)

## 0) Objective

- Retrieve the right evidence quickly and deterministically.
- Never allow lower-precedence categories (especially `marketing`) to outrank policy categories for policy-like claims.
- Produce a bounded evidence pack for drafting and operator-visible citations.
- Trigger `Needs review` / "I don't know" when evidence is insufficient, stale-only, or conflicting.

Alignment notes:
- Category precedence, conflict, and staleness semantics follow `docs/phases/phase-7-knowledge/knowledge-taxonomy-v1.md`.
- Candidate artifacts and metadata fields assume ingestion outputs from `docs/phases/phase-7-knowledge/ingestion-pipeline-v1.md`.
- Evidence pack and citation payloads align with `docs/phases/phase-7-knowledge/chunking-and-citations-v1.md`.

## 1) Inputs to retrieval

Runtime retrieval inputs:
- Tenant context: `tenant_id` (mandatory).
- Email content: thread messages with latest guest message emphasized.
- Optional structured trip context (future-compatible): `trip_id`, trip date, product name.
- Sensitivity flags from triage (conceptual): `refund`, `safety`, `medical`, `legal`, `exceptions`.
- Retrieval configuration (tunable):
  - `K_v`, `K_l`, candidate cap.
  - Evidence pack max size.
  - Staleness thresholds and confidence thresholds.

## 2) Query generation (deterministic)

Deterministic query generation steps:
1. Normalize input text:
   - Lowercase for matching.
   - Normalize punctuation/whitespace.
   - Preserve important symbols and date tokens.
2. Extract key entities and intents:
   - Trip names, route/location names, dates.
   - Policy intents: `refund`, `cancel`, `cancellation`, `deposit`, `payment`, `waiver`, `medical`, `safety`, `age`, `dietary`.
3. Generate `2-4` query variants:
   - Variant 1: direct guest intent query.
   - Variant 2: policy expansion query when policy-like signals are present.
   - Variant 3: trip-specific query when itinerary context is present.
   - Variant 4: exact-term lexical query for quoted terms, codes, and proper names.

Stopword removal + normalization rules:
- Remove common stopwords (example: `the`, `a`, `an`, `please`, `thanks`) after entity extraction.
- Keep domain-critical terms even if short (`age`, `fee`, `PFD`, `waiver`).
- Normalize date expressions to canonical text tokens where possible (example: `June 14` -> `jun 14`).
- Avoid stochastic query rewriting; same input yields same variants.

## 3) Candidate retrieval (hybrid)

Hybrid retrieval strategy:
- Vector search over embeddings (pgvector) returns top `K_v` candidates.
- Lexical search (tsvector) returns top `K_l` candidates.
- Union both sets and de-duplicate by (`doc_version_id`, `chunk_id`).

Default tunable values:
- `K_v = 24`
- `K_l = 16`
- Candidate cap after union = `40`

Candidate eligibility filters:
- `tenant_id` scoped only.
- Exclude non-ready ingestion states by requiring indexed-ready artifacts.
- Exclude superseded versions by default (audit mode can override separately).

## 4) Ranking model (precedence + staleness + relevance)

### 4.1 Hard constraints (must never violate)

- Exclude superseded document versions by default.
- For policy-like claims, enforce category precedence tiers from Step 7.2.
- Implement as tiered ranking:
  - Rank within each precedence tier first.
  - Merge tiers in precedence order so lower tiers cannot outrank higher tiers for policy claims.

Tier order (highest to lowest) uses Step 7.2:
1. `structured_policy`
2. `terms_policy`
3. `waiver_release`
4. `safety_medical`
5. `trip_itinerary`
6. `faq`
7. `packing_list`
8. `operations_internal`
9. `marketing`

### 4.2 Soft ranking signals (within a tier)

Within the same category tier, rank by:
- Retrieval relevance score (hybrid score from vector and lexical signals).
- Admin `priority` (higher wins).
- `effective_date` recency (newer preferred when relevant).
- `last_reviewed_at` recency (newer preferred).
- Staleness penalty when `last_reviewed_at` is older than 180 days.
- Near-duplicate penalty for chunks from same doc/section with overlapping content.

Staleness rule:
- Staleness never changes tier precedence.
- Staleness only affects ordering and warning flags within applicable tiers.

### 4.3 MMR / diversity selection

Apply diversity selection (MMR-style) on ranked candidates before final evidence pack:
- Reduce near-identical chunk repetition.
- Prefer varied sections and documents while preserving high relevance.
- For policy-like claims, target at least 2 distinct sources when possible (for example `structured_policy` + `terms_policy`) unless one canonical source is sufficient and unambiguous.

## 5) Evidence pack selection

Evidence pack constraints (aligned with Step 7.4):
- Pack size: `4-10` chunks maximum (default max `10`).
- For policy-like claims, include at least one high-precedence chunk from:
  - `structured_policy`, or
  - `terms_policy` / `waiver_release` when structured policy is absent for that claim class.
- Attach citation payload per selected chunk:
  - `doc_title`, `category`, `source_locator`, `chunk_id`, `confidence_score`.
- Emit warning flags at pack level:
  - `stale_only_evidence` (boolean)
  - `conflicting_evidence` (boolean)
  - `low_confidence` (boolean)

## 6) Conflict detection (retrieval-time signals)

Heuristics that set conflict signals:
- Contradictory numeric windows from top chunks in same precedence tier (example: `24 hours` vs `7 days`).
- `structured_policy` and `terms_policy` disagree on policy-critical value.
- Multiple high-ranking `terms_policy` versions without supersedes linkage.
- Exception requests requiring human discretion even if policy text exists (example: special medical waiver request).

Outcome rules:
- If conflict detected, set `conflicting_evidence=true`.
- For sensitive topics (`refund/safety/medical/legal/exceptions`), default to `Needs review` when conflicts exist.
- For non-sensitive topics, allow draft generation with explicit internal warning and evidence display.

## 7) "I don't know" / escalation rules (retrieval-driven)

Deterministic escalation rules:
- If no evidence chunk meets minimum confidence threshold, return unknown behavior.
- If only stale evidence exists and topic is sensitive, set `Needs review`.
- If evidence exists but required high-precedence category is missing for a policy claim, set `Needs review`.
- If `conflicting_evidence=true`, set `Needs review` for sensitive topics.

Default confidence thresholds (tunable):
- `low_confidence=true` if top `confidence_score < 0.72`.
- Unknown (`I don't know`) if no chunk has `confidence_score >= 0.65`.

## 8) Worked examples

### Example 1: Refund/cancellation where policy sources beat marketing

Input email:
- "Can we cancel 5 days before and still get a full refund? The brochure says 24-hour cancellation."

Queries generated:
- Direct: `cancel 5 days full refund`
- Policy expansion: `cancellation refund window terms policy`
- Trip-specific: omitted (no specific trip entity)
- Exact lexical: `"24-hour cancellation" brochure`

Candidate sets (brief):
- Vector top includes `structured_policy` refund chunk, `terms_policy` cancellation section, `marketing` brochure snippet.
- Lexical top includes brochure phrase match and terms section phrase match.

Final evidence pack:
- `structured_policy` | `docv:docv_policy_refund_v5#chunk:000|p:-|sec:Refund-Window` | score `0.93`
- `terms_policy` | `docv:docv_2026_terms_v2#chunk:012|p:3-3|sec:Cancellations-and-Refunds` | score `0.88`
- `marketing` | `docv:docv_brochure_2026#chunk:021|p:7-7|sec:Flexible-Booking` | score `0.86` (kept as contextual but cannot override)

Flags:
- `stale_only_evidence=false`
- `conflicting_evidence=true` (brochure contradicts policy window)
- `low_confidence=false`

Outcome:
- Sensitive refund topic + conflict => `Needs review` default, with policy-tier citations visible.

### Example 2: Trip check-in time where itinerary wins over FAQ

Input email:
- "What time is check-in for the June 14 Patagonia departure?"

Queries generated:
- Direct: `june 14 patagonia check in time`
- Policy expansion: not required
- Trip-specific: `patagonia june 14 departure itinerary day 1 arrival`
- Exact lexical: `"June 14" "check-in"`

Candidate sets (brief):
- Top itinerary chunk (day 1 arrival, 06:00), top FAQ chunk (08:00 general), additional itinerary logistics chunk.

Final evidence pack:
- `trip_itinerary` | `docv:docv_patagonia_jun14_v1#chunk:003|p:1-1|sec:Day-1-Arrival` | score `0.91`
- `trip_itinerary` | `docv:docv_patagonia_jun14_v1#chunk:004|p:1-2|sec:Arrival-Logistics` | score `0.82`
- `faq` | `docv:docv_guest_faq_v9#chunk:030|p:-|sec:Arrival` | score `0.80`

Flags:
- `stale_only_evidence=false`
- `conflicting_evidence=false`
- `low_confidence=false`

Outcome:
- Tiered ranking prioritizes `trip_itinerary` for trip-specific answer; FAQ treated as secondary context.

### Example 3: Medical/safety with stale-only evidence

Input email:
- "Do I need medical clearance for this altitude trip?"

Queries generated:
- Direct: `medical clearance altitude trip`
- Policy expansion: `safety medical requirement physician clearance`
- Trip-specific: `altitude itinerary medical requirement`
- Exact lexical: `"medical clearance"`

Candidate sets (brief):
- Retrieved `safety_medical` chunks from old version only; no recent structured policy or terms entry.

Final evidence pack:
- `safety_medical` | `docv:docv_medical_policy_v2#chunk:007|p:4-4|sec:Medical-Clearance` | score `0.84`
- `safety_medical` | `docv:docv_medical_policy_v2#chunk:008|p:4-5|sec:Cardiac-Conditions` | score `0.79`

Flags:
- `stale_only_evidence=true`
- `conflicting_evidence=false`
- `low_confidence=false`

Outcome:
- Sensitive medical topic + stale-only evidence => `Needs review` required before sending.

## 9) Acceptance test checklist (docs-only)

- For known test emails, evidence pack includes expected categories and citation fields.
- Marketing never outranks `terms_policy`/`structured_policy` for policy-like claims.
- Superseded versions are excluded by default retrieval path.
- Conflict scenarios consistently set `conflicting_evidence=true` and route to `Needs review` for sensitive topics.
- Evidence pack size remains within configured bounds (`4-10`, default max `10`).
- Latency target placeholder for runtime implementation: p95 retrieval under `1.5s` (excluding model generation).
