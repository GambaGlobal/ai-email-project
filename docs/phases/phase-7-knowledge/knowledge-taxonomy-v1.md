# Knowledge Taxonomy v1 (Phase 7)

## 1) Definition of "Knowledge" (for this product)

In v1, "knowledge" means tenant-owned sources of truth plus derived retrieval artifacts used to generate Gmail drafts with deterministic, auditable behavior.

Knowledge inputs:
- Operator-uploaded docs.
- Structured Policy Entries (form-based), recommended as the canonical layer for policy claims.
- Optional house style guidance (tone/voice) for wording consistency.

Derived retrieval artifacts:
- Parsed text.
- Chunks with stable IDs.
- Embeddings and index records.
- Document metadata (including `priority`, `effective_date`, `last_reviewed_at`, and `audience`).
- Conflict signals (for contradictions and superseded versions).

Non-goals for v1:
- Website crawling or sitemap ingestion.
- OCR-based ingestion from scanned PDFs or images.
- Auto-sending emails.
- Treating AI output as a policy source of truth.

## 2) Supported doc types (v1) and why

Supported:
- PDF (digital text): common operator format with predictable parsing when machine-readable text exists.
- DOCX: common internal editing format that preserves policy and itinerary content.
- TXT / Markdown: low-complexity, high-reliability ingestion for canonical text.
- HTML/Text paste: supports quick admin entry and copied policy updates without file packaging.
- Structured Policy Entries (form-based): explicit, fielded policies reduce ambiguity and are preferred for deterministic conflict resolution.

Not supported yet (v1):
- Scanned PDFs/images requiring OCR: OCR confidence and extraction noise reduce trust for policy-critical claims.
- Website crawling/connectors: volatile, hard-to-audit source boundaries and freshness for trust-first v1.
- Spreadsheets as first-class ingestion (XLSX/CSV): table semantics are inconsistent and require dedicated normalization not in v1 scope.
- Direct third-party knowledge connectors (e.g., shared drives/wiki APIs): broader auth and provenance complexity is deferred until ingestion controls mature.

## 3) Knowledge taxonomy (doc categories)

| Category identifier | Examples | Audience | Typical change frequency | Risk level | Notes |
| --- | --- | --- | --- | --- | --- |
| `structured_policy` | `Refund policy entry`, `Cancellation window entry` | guest-facing | monthly | High | Canonical when present; highest precedence. |
| `terms_policy` | `2026 Terms and Conditions.pdf`, `Booking Terms v4.docx` | both | quarterly | High | Contractual source for booking/refund rules. |
| `waiver_release` | `Guest Liability Waiver.pdf`, `Photo Release Terms.docx` | both | quarterly | High | Legal commitments and acknowledgment language. |
| `safety_medical` | `Medical Disclosure Policy.pdf`, `Emergency Action Plan Guest Copy.docx` | both | monthly | High | Safety-critical; stale evidence requires caution. |
| `trip_itinerary` | `Patagonia Trek 7-Day Itinerary.pdf`, `June 2026 Departure Plan.docx` | guest-facing | weekly | Medium | Trip-specific operational details. |
| `faq` | `Guest FAQ.md`, `Pre-trip Questions.txt` | guest-facing | weekly | Medium | Broad guidance; not authoritative over policy docs. |
| `packing_list` | `Winter Expedition Packing List.pdf`, `Kayak Trip Checklist.md` | guest-facing | seasonal | Medium | Seasonal and route-dependent requirements. |
| `operations_internal` | `Ops Runbook - Airport Pickup.docx`, `Guide Staffing Notes.md` | internal | weekly | Low | Internal context; should not override guest policy claims. |
| `marketing` | `2026 Adventure Brochure.pdf`, `Landing Page Copy.txt` | guest-facing | monthly | High | Persuasive copy only; must never override policy terms. |

### Category Naming Rules

- Use `snake_case` only.
- Category identifiers are stable; do not rename categories without a Decision Record amendment.
- In v1, one document version maps to exactly one category.

## 4) Doc priority ladder (conflict tie-breaker)

Strict precedence (highest wins):
1. `structured_policy`
2. `terms_policy`
3. `waiver_release`
4. `safety_medical`
5. `trip_itinerary`
6. `faq`
7. `packing_list`
8. `operations_internal`
9. `marketing`

Rationale:
- Trust is prioritized over recency.
- Marketing content must never override policy content.
- Structured Policy Entries are canonical when present.

Tie-breakers within the same category (in exact order):
1. Explicit `supersedes` chain wins.
2. Higher admin-set `priority` integer wins.
3. Newer `effective_date` wins.
4. Newer `last_reviewed_at` wins.
5. If still conflicting or unclear, mark as `human review required` (no silent resolution).

## 5) Required metadata fields (v1)

Minimum metadata required per document and per version:
- `tenant_id`.
- `doc_id` and `doc_version_id`.
- `source_type` (`upload` | `paste` | `structured_entry`).
- `category` (must be one taxonomy value above).
- `priority` (admin-set integer; default `100`; guidance: reserve `200+` for exceptional override intent within same category).
- `effective_date` (optional but encouraged): first date this version should be treated as policy-effective.
- `last_reviewed_at` (optional): last admin confirmation date that content is still valid.
- `supersedes_doc_version_id` (optional): explicit replacement pointer for deterministic tie-breaks.
- `created_at` and `updated_at`.
- `uploaded_by` (user id).
- `checksum`/`content_hash`.
- `language` (optional, BCP-47 or equivalent internal representation).

Operator UI labels (for admin-facing metadata controls):
- Category
- Priority
- Effective date
- Last reviewed
- Supersedes / Replaces

## 6) Staleness policy (v1)

Definition:
- A source is considered stale when review recency or seasonality signals indicate potential drift from current operations.

Default thresholds:
- Warn when `last_reviewed_at` is older than 180 days.
- Warn when `effective_date` appears out-of-season for the request context (guidance rule, not a hard block).

Ranking and safety behavior:
- Staleness does not override category precedence.
- Staleness only adjusts ranking confidence within the same category.
- If only stale sources exist for a policy claim, emit an internal warning signal.
- For sensitive topics (`refund`, `safety`, `medical`, `legal`, `exceptions`) with only stale evidence, default to `Needs review` / human confirmation.

## 7) Concrete conflict scenarios

### Scenario 1: Marketing says "24h cancellation" vs Terms says "7 days"

Inputs:
- Doc A: `marketing`, `priority=150`, claim="24h cancellation".
- Doc B: `terms_policy`, `priority=100`, claim="7 days before departure".

Winner selection:
1. Compare categories using precedence ladder.
2. `terms_policy` outranks `marketing`.
3. Tie-breakers are not needed.

Expected system behavior:
- Use the `terms_policy` claim in draft generation.
- Include citation to terms document version.
- Add internal note that lower-priority marketing claim was suppressed.

### Scenario 2: Two terms_policy PDFs conflict; one supersedes the other

Inputs:
- Doc A: `terms_policy`, `doc_version_id=tp_v3`, `effective_date=2026-01-01`, no supersedes.
- Doc B: `terms_policy`, `doc_version_id=tp_v4`, `supersedes_doc_version_id=tp_v3`, `effective_date=2026-03-01`.

Winner selection:
1. Same category (`terms_policy`), so apply tie-breakers.
2. `supersedes` chain exists from `tp_v4` to `tp_v3`; `tp_v4` wins.
3. Remaining tie-breakers are not needed.

Expected system behavior:
- Retrieve and cite `tp_v4`.
- Record supersession resolution in conflict/audit signal.

### Scenario 3: Trip itinerary conflicts with general FAQ

Inputs:
- Doc A: `trip_itinerary`, claim="Check-in at 06:00" for specific departure.
- Doc B: `faq`, claim="Typical check-in at 08:00".

Winner selection:
1. Compare categories using precedence ladder.
2. `trip_itinerary` outranks `faq`.
3. Tie-breakers are not needed.

Expected system behavior:
- Use itinerary-specific check-in time in draft.
- Cite itinerary source.
- Optionally include phrasing that FAQ timing is general guidance.

### Scenario 4: structured_policy conflicts with older policy PDF

Inputs:
- Doc A: `structured_policy`, `priority=100`, claim="Refund window is 10 days".
- Doc B: `terms_policy`, older PDF claim="Refund window is 14 days".

Winner selection:
1. Compare categories using precedence ladder.
2. `structured_policy` outranks `terms_policy` by definition.
3. Tie-breakers are not needed.

Expected system behavior:
- Use `structured_policy` value in generated draft.
- Require citation to structured policy entry ID/version.
- Emit internal discrepancy signal for admin cleanup queue.

### Scenario 5: safety_medical vs FAQ with stale evidence

Inputs:
- Doc A: `safety_medical`, `last_reviewed_at` older than 180 days, claim on medication requirements.
- Doc B: `faq`, recently reviewed, conflicting simplified claim.

Winner selection:
1. Compare categories using precedence ladder.
2. `safety_medical` outranks `faq`.
3. Staleness cannot demote category precedence.

Expected system behavior:
- Keep `safety_medical` as authoritative source.
- Because only stale evidence exists for a sensitive topic, mark outcome `Needs review` for human confirmation.
- Present draft with cautionary language and clear citation.
