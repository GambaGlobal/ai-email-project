# Chunking & Citations v1 (Evidence You Can Trust)

## 0) Objective

- Every policy-like claim in a draft must be traceable to explicit evidence.
- Citations are operator-visible (internal) and are not sent to guests by default.
- Chunking is deterministic: same normalized input and config yields same chunks and IDs.

## 1) Definitions (v1 vocabulary)

- Document / DocumentVersion:
  - Document is a stable logical source (for example, `2026 Terms and Conditions`).
  - DocumentVersion is an immutable snapshot tied to one `doc_version_id` and `content_hash`.
- Normalized text:
  - Parser output after canonical cleanup (whitespace normalization, heading markers, stable line treatment) as defined by ingestion in `docs/phases/phase-7-knowledge/ingestion-pipeline-v1.md`.
- Chunk:
  - Deterministically segmented unit of normalized text with stable metadata (`chunk_id`, `chunk_index`, anchors).
- Evidence pack:
  - Bounded set of retrieved chunks used to support draft claims for one email response.
- Citation (internal):
  - Structured reference attached to a claim, pointing to exact source evidence (doc version + locator + chunk).
- Policy-like claim:
  - A claim that states or implies rules/commitments (refunds, legal, safety, medical, inclusions/exclusions, exceptions) and therefore requires evidence.
- Confidence:
  - Retrieval confidence: score that retrieved evidence is relevant to claim grounding.
  - Model confidence: model self-estimate (not used as evidence authority). v1 relies on retrieval confidence and evidence traceability, not model self-confidence.

## 2) Chunking strategy (deterministic)

### 2.1 Default chunk targets

- Target size: `500-900` tokens.
- Overlap: `10-15%`.
- Boundary preference order: headings -> paragraphs -> sentences.
- Preserve semantic anchors whenever available:
  - Section titles.
  - PDF page numbers/page ranges.
  - List-item context (numbered/bulleted scope).

### 2.2 Category-aware notes (without changing defaults)

v1 keeps one default algorithm across all categories for predictability and easier auditability, aligned to `docs/phases/phase-7-knowledge/knowledge-taxonomy-v1.md`.

- `terms_policy` / `waiver_release`: smaller, more atomic chunks are preferred in future tuning due to legal precision needs.
- `trip_itinerary` / `faq`: slightly larger chunks are often acceptable in future tuning because context spans adjacent details.
- `marketing`: chunks are still generated, but retrieval ranking must respect Phase 7.2 precedence so marketing never outranks policy categories.

### 2.3 Determinism rules

- Stable canonicalization only (deterministic whitespace normalization and heading markers).
- Chunk boundaries are computed only from normalized text structure and token limits.
- No time-based randomness.
- No dependence on external mutable state at chunk-time.
- Same (`doc_version_id`, `chunker_version`) input must produce same `chunk_index` and `chunk_id` sequence.

## 3) Chunk metadata requirements (v1)

Every chunk record must include:
- `tenant_id`
- `doc_id`
- `doc_version_id`
- `category`
- `chunk_id` (stable within `doc_version_id`)
- `chunk_index` (`0..n`)
- `section_title` (nullable)
- `page_range` (nullable, PDF)
- `source_locator` (string)
- `token_count`
- `text`
- `policy_likeness_hint` (`Low` | `Medium` | `High`)
- `created_at`

`source_locator` format (concrete):
- `docv:{doc_version_id}#chunk:{zero_padded_chunk_index}|p:{page_start}-{page_end}|sec:{section_title_slug}`
- Example:
  - `docv:docv_2026_terms_v1#chunk:012|p:3-4|sec:Cancellations`

## 4) Citation scheme (operator-visible)

### 4.1 Citation object (internal)

Minimal citation payload attached to each draft claim:
- `doc_title`
- `doc_version_id` (or short version label)
- `category`
- `source_locator` (encodes `page_range` + `section_title`)
- `chunk_id`
- `snippet` (optional, max `240` chars, UI preview)
- `confidence_score` (retrieval score, not model confidence)

### 4.2 How citations appear in UI (conceptual, no code)

- Each important claim surfaces one or more `Evidence` chips.
- Clicking a chip shows: document name, category, page range/section, and highlighted snippet.
- UI provides `Open doc` action that links to the stored version artifact for verification.

### 4.3 Guest-facing policy (default)

- Citations are not included in outgoing guest email by default.
- If a future setting exposes references, phrasing should be human-readable (for example, "Per our Terms, Cancellation section") and must not expose internal IDs (`chunk_id`, raw locators).

## 5) Policy-like claim rules (must be explicit)

Claims requiring citations include:
- Refund, cancellation, deposit, and payment schedule statements.
- Age, fitness, and medical requirements.
- Safety rules and weather cancellation logic.
- Waiver, legal, and liability language.
- Inclusions/exclusions, guarantees, and exception handling.

Minimum evidence requirement:
- Each policy-like sentence must have `>= 1` citation.
- If zero citations are found, treat as unsupported claim and default to `Needs review` or an explicit "I don't know"-style response path per trust-first Phase 7 behavior.

## 6) Evidence pack construction constraints

- Max evidence pack size per response: `4-10` chunks.
- Diversity rule:
  - Prefer evidence from multiple chunks and, when relevant, multiple documents/categories.
  - Avoid near-duplicate chunks that repeat the same sentence span.
- Precedence rule (from Step 7.2):
  - Evidence selection and final claim grounding must never elevate `marketing` above `terms_policy`, `structured_policy`, or other higher-priority categories.
- Staleness hints (from Step 7.2):
  - If only stale evidence is available for a claim, include internal warning flag.
  - For sensitive claims with stale-only evidence, outcome must be `Needs review`.

## 7) Examples

### Example 1: Cancellation/refund policy with terms evidence

Email question:
- "If we cancel 5 days before departure, do we get a refund?"

Retrieved chunks:
- Chunk A:
  - `doc_title`: `2026 Terms and Conditions.pdf`
  - `doc_version_id`: `docv_2026_terms_v2`
  - `category`: `terms_policy`
  - `chunk_id`: `docv_2026_terms_v2_p03_s02`
  - `section_title`: `Cancellations and Refunds`
  - `page_range`: `3-3`
  - `source_locator`: `docv:docv_2026_terms_v2#chunk:012|p:3-3|sec:Cancellations-and-Refunds`
  - `policy_likeness_hint`: `High`
- Chunk B:
  - `doc_title`: `Refund Policy Entry`
  - `doc_version_id`: `docv_policy_refund_v5`
  - `category`: `structured_policy`
  - `chunk_id`: `docv_policy_refund_v5_000`
  - `section_title`: `Refund Window`
  - `page_range`: null
  - `source_locator`: `docv:docv_policy_refund_v5#chunk:000|p:-|sec:Refund-Window`
  - `policy_likeness_hint`: `High`

Draft claim(s):
- "Per our current policy, cancellations made within 7 days of departure are non-refundable."

Attached citations (objects):
```json
[
  {
    "doc_title": "Refund Policy Entry",
    "doc_version_id": "docv_policy_refund_v5",
    "category": "structured_policy",
    "source_locator": "docv:docv_policy_refund_v5#chunk:000|p:-|sec:Refund-Window",
    "chunk_id": "docv_policy_refund_v5_000",
    "snippet": "Cancellations within 7 calendar days of departure are non-refundable.",
    "confidence_score": 0.93
  },
  {
    "doc_title": "2026 Terms and Conditions.pdf",
    "doc_version_id": "docv_2026_terms_v2",
    "category": "terms_policy",
    "source_locator": "docv:docv_2026_terms_v2#chunk:012|p:3-3|sec:Cancellations-and-Refunds",
    "chunk_id": "docv_2026_terms_v2_p03_s02",
    "snippet": "Refund eligibility changes at 7 days prior to departure.",
    "confidence_score": 0.88
  }
]
```

Resolution note:
- `structured_policy` is treated as canonical over `terms_policy` per Step 7.2 precedence.

### Example 2: Trip-specific check-in time vs FAQ

Email question:
- "What time should we check in for the June 14 Patagonia departure?"

Retrieved chunks:
- Chunk A (`trip_itinerary`): section `Day 1 Arrival`, `page_range=1-1`, claim "Check-in at 06:00".
- Chunk B (`faq`): section `Arrival`, no page range, claim "Typical check-in is 08:00".

Draft claim(s):
- "For the June 14 Patagonia departure, check-in is at 06:00."

Attached citations (objects):
```json
[
  {
    "doc_title": "Patagonia Trek 7-Day Itinerary.pdf",
    "doc_version_id": "docv_patagonia_jun14_v1",
    "category": "trip_itinerary",
    "source_locator": "docv:docv_patagonia_jun14_v1#chunk:003|p:1-1|sec:Day-1-Arrival",
    "chunk_id": "docv_patagonia_jun14_v1_p01_s01",
    "snippet": "Day 1 check-in opens at 06:00 local time.",
    "confidence_score": 0.91
  }
]
```

Resolution note:
- `trip_itinerary` outranks `faq` for trip-specific operational details under Step 7.2 ordering.

### Example 3: Safety/medical answer with stale-only evidence

Email question:
- "Do I need a doctor clearance for this high-altitude trip?"

Retrieved chunks:
- Chunk A (`safety_medical`) from `docv_medical_policy_v2`, `last_reviewed_at` older than 180 days, section `Medical Clearance`, `policy_likeness_hint=High`.
- No fresher policy chunk found.

Draft claim(s):
- "Our current medical policy may require doctor clearance for high-altitude departures; this needs team confirmation before we finalize guidance."

Attached citations (objects):
```json
[
  {
    "doc_title": "Medical Disclosure Policy.pdf",
    "doc_version_id": "docv_medical_policy_v2",
    "category": "safety_medical",
    "source_locator": "docv:docv_medical_policy_v2#chunk:007|p:4-4|sec:Medical-Clearance",
    "chunk_id": "docv_medical_policy_v2_p04_s03",
    "snippet": "Participants with cardiovascular conditions may need physician clearance.",
    "confidence_score": 0.84
  }
]
```

Outcome and warning:
- Internal warning flag: `stale_evidence_only=true`.
- Because claim is sensitive and stale-only, route to `Needs review` before operator sends.

## 8) Acceptance test checklist (docs-only)

- Given a known policy email, generated draft includes citations for every policy-like claim.
- Each citation resolves to the correct `doc_version_id` and page/section locator.
- Retrieval excludes superseded versions by default; superseded evidence appears only when explicitly requested for audit mode.
- If no evidence exists, the system must not assert the claim and must produce `Needs review` or explicit unknown behavior.
