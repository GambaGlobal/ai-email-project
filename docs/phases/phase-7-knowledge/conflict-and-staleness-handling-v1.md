# Conflict & Staleness Handling v1 (When to Escalate)

## 0) Objective

- Detect conflicts and stale-only evidence deterministically.
- Apply explicit `Needs review` triggers with zero silent policy invention.
- Show operator-visible escalation reasons with evidence pointers/citations.

Alignment:
- Category precedence and tie-breakers follow `docs/phases/phase-7-knowledge/knowledge-taxonomy-v1.md`.
- Policy-like claim citation requirements follow `docs/phases/phase-7-knowledge/chunking-and-citations-v1.md`.
- Confidence thresholds and retrieval warning flags follow `docs/phases/phase-7-knowledge/retrieval-and-ranking-v1.md`.

## 1) Definitions

- conflict (evidence disagreement):
  - Eligible evidence chunks assert incompatible claim values for the same question scope.
- stale evidence:
  - Evidence with `last_reviewed_at > 180 days`, and/or evidence with out-of-season `effective_date` guidance signal (warning-only by itself).
- stale-only evidence:
  - All evidence chunks that passed retrieval filters are stale.
- sensitive topic:
  - `refund`, `safety`, `medical`, `legal`, `exceptions`.
- escalation outcomes:
  - `OK_TO_DRAFT`: draft can proceed with citations.
  - `ASK_CLARIFYING_QUESTION`: generate a guest-facing clarification question draft before asserting policy.
  - `NEEDS_REVIEW`: operator must decide before sending.
  - `UNKNOWN`: explicit "I don't know" handling path.

## 2) Conflict classes (v1)

| Conflict class | Typical categories involved | Detection heuristic (deterministic) | Default severity | Default escalation outcome |
| --- | --- | --- | --- | --- |
| `NUMERIC_WINDOW_CONFLICT` | `structured_policy`, `terms_policy`, `marketing` | Same claim type includes different numeric windows/amounts (`24h` vs `7 days`, `20%` vs `30%`). | High | `NEEDS_REVIEW` for sensitive topics; otherwise `ASK_CLARIFYING_QUESTION` if unresolved after precedence filtering. |
| `INCLUSIONS_EXCLUSIONS_CONFLICT` | `trip_itinerary`, `faq`, `terms_policy` | One chunk says item included, another says excluded (same product/date scope). | Medium | `NEEDS_REVIEW` when financial impact exists; else `ASK_CLARIFYING_QUESTION`. |
| `WAIVER_LEGAL_CONFLICT` | `waiver_release`, `terms_policy`, `structured_policy` | Liability/waiver requirements differ materially between top-tier chunks. | High | `NEEDS_REVIEW`. |
| `SAFETY_MEDICAL_REQUIREMENT_CONFLICT` | `safety_medical`, `structured_policy`, `faq` | Medical/fitness requirement present in one authoritative chunk but contradicted by another. | High | `NEEDS_REVIEW`. |
| `ITINERARY_LOGISTICS_CONFLICT` | `trip_itinerary`, `faq`, `operations_internal` | Check-in/meeting-point/time mismatch for same trip date. | Medium | `OK_TO_DRAFT` using higher-precedence itinerary evidence when unambiguous; else `ASK_CLARIFYING_QUESTION`. |
| `EXCEPTION_REQUEST` | Any policy category | Guest asks to override policy (for example missed deadline, special waiver exception). | High | `NEEDS_REVIEW`. |
| `OUT_OF_SCOPE_REQUEST` | None or weak matches | No policy artifacts cover requested guarantee/advice (for example bespoke legal guarantee). | Medium | `UNKNOWN` by default; `NEEDS_REVIEW` if risk-sensitive and operator decision is required. |

Notes:
- Conflict checks run after precedence-tier retrieval from Step 7.5.
- If precedence filtering yields one authoritative, unambiguous answer, lower-tier disagreement (for example `marketing`) is recorded as suppressed rather than treated as unresolved conflict.

## 3) Staleness handling (v1)

When to set stale flags:
- Set stale warning if `last_reviewed_at > 180 days`.
- Set out-of-season warning when `effective_date` likely mismatches request context (guidance):
  - Example: winter equipment policy used for summer itinerary month.
  - Example: seasonal departure rules from prior season reused for current season.

Behavioral effects:
- Staleness never overrides precedence tiers.
- Staleness always emits operator-visible warning metadata.
- If `stale_only_evidence=true` and topic is sensitive -> `NEEDS_REVIEW`.
- If `stale_only_evidence=true` and topic is non-sensitive -> `OK_TO_DRAFT` with internal warning, unless evidence is low-confidence (then escalate per matrix).

## 4) Escalation decision matrix (deterministic)

Thresholds from Step 7.5:
- `low_confidence=true` when top `confidence_score < 0.72`.
- `unknown` threshold when no chunk has `confidence_score >= 0.65`.

| Row | Topic sensitivity | Evidence availability | stale_only | conflict_detected | exception_request | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Sensitive | None (`<0.65`) | N/A | false | false | `UNKNOWN` |
| 2 | Non-sensitive | None (`<0.65`) | N/A | false | false | `UNKNOWN` |
| 3 | Sensitive | Low confidence (`0.65-0.71`) | false | false | false | `ASK_CLARIFYING_QUESTION` |
| 4 | Non-sensitive | Low confidence (`0.65-0.71`) | false | false | false | `ASK_CLARIFYING_QUESTION` |
| 5 | Sensitive | Sufficient (`>=0.72`) | false | false | false | `OK_TO_DRAFT` |
| 6 | Non-sensitive | Sufficient (`>=0.72`) | false | false | false | `OK_TO_DRAFT` |
| 7 | Sensitive | Sufficient (`>=0.72`) | true | false | false | `NEEDS_REVIEW` |
| 8 | Non-sensitive | Sufficient (`>=0.72`) | true | false | false | `OK_TO_DRAFT` (with stale warning) |
| 9 | Sensitive | Sufficient (`>=0.72`) | false | true | false | `NEEDS_REVIEW` |
| 10 | Non-sensitive | Sufficient (`>=0.72`) | false | true | false | `ASK_CLARIFYING_QUESTION` or `NEEDS_REVIEW` if legal/financial risk |
| 11 | Sensitive | Any (`>=0.65`) | any | any | true | `NEEDS_REVIEW` |
| 12 | Non-sensitive | Low confidence (`0.65-0.71`) | true | false | false | `ASK_CLARIFYING_QUESTION` |

Matrix notes:
- If required high-precedence policy category evidence is missing for a policy-like claim, override to `NEEDS_REVIEW`.
- Conflicts between terms versions without supersedes linkage always override to `NEEDS_REVIEW`.

## 5) Operator-facing reason codes (v1)

| Reason code | Description | Operator next action | Evidence references shown |
| --- | --- | --- | --- |
| `CONFLICT_NUMERIC_WINDOW` | Numeric policy windows/amounts disagree. | Verify authoritative policy version; update supersedes/priority if needed. | Conflicting doc titles + `source_locator` for each chunk. |
| `CONFLICT_INCLUSIONS_EXCLUSIONS` | Inclusion/exclusion statements conflict. | Confirm current inclusion matrix and adjust policy docs. | Doc titles, sections, and page/locator links. |
| `CONFLICT_WAIVER_LEGAL` | Waiver/legal obligations differ across sources. | Route to legal/policy owner; do not send definitive legal claim. | Waiver/terms doc titles + locators. |
| `CONFLICT_SAFETY_MEDICAL` | Safety/medical requirements disagree. | Request medical/safety owner confirmation before sending. | Safety doc title + conflicting source locators. |
| `CONFLICT_ITINERARY_LOGISTICS` | Trip logistics values mismatch. | Confirm departure-specific itinerary details and correct FAQ if needed. | Itinerary + FAQ locators with timestamps/versions. |
| `STALE_ONLY_EVIDENCE` | All retrieved evidence is stale. | Review and refresh policy docs; confirm before sending sensitive claims. | Top stale doc titles + review dates + locators. |
| `LOW_CONFIDENCE_EVIDENCE` | Evidence below confidence threshold for assertive answer. | Ask guest clarifying question or review manually. | Retrieved chunk list with `confidence_score`. |
| `NO_EVIDENCE_FOUND` | No eligible chunk met unknown threshold. | Do not assert policy; ask clarifying question or escalate. | None (explicitly show no locator available). |
| `EXCEPTION_REQUEST` | Guest requests policy exception/discretion. | Operator decides exception handling manually. | Relevant policy chunks + guest request excerpt. |
| `OUT_OF_SCOPE` | Request is not covered by known docs. | Respond with unknown/clarification and route if needed. | Optional weak matches; usually no authoritative locator. |

## 6) Drafting behaviors for escalations (templates)

Constraints:
- Never assert policy without citations.
- Never promise exceptions.
- Keep wording neutral and on-brand without heavy legal language.

`ASK_CLARIFYING_QUESTION` template:
- "Thanks for the question. To confirm the correct policy for your booking, could you share [trip/date or booking reference]?"
- "I’ll confirm the exact details and follow up right away."

`NEEDS_REVIEW` template:
- Guest-facing: "Thanks for checking this. I’m confirming the most accurate policy details with our team and will reply shortly."
- Internal note: "Escalated due to {reason_code}; review evidence locators before sending final policy statement."

`UNKNOWN` template:
- "I don’t have enough verified information in our current records to answer this accurately yet."
- "If you share [specific missing detail], I can route this for confirmation and get you a precise answer."

## 7) Worked scenarios

### Scenario 1: Marketing vs terms_policy numeric mismatch

Email ask:
- "Your brochure says 24-hour cancellation. Can I cancel tomorrow?"

Evidence pack summary:
- `terms_policy` chunk score `0.88`, locator `p:3-3` says `7 days`.
- `marketing` chunk score `0.86`, locator `p:7-7` says `24 hours`.
- Flags: `conflicting_evidence=false` after tier precedence, `stale_only_evidence=false`.

Detected class:
- Initially candidate mismatch, but resolved by precedence tiering; no unresolved conflict class emitted.

Outcome:
- `OK_TO_DRAFT` using `terms_policy` citation; include internal note that marketing claim was suppressed.

### Scenario 2: Two terms_policy versions disagree without supersedes link

Email ask:
- "What is your cancellation deadline?"

Evidence pack summary:
- `terms_policy` `docv_terms_v3` score `0.84` says `7 days`.
- `terms_policy` `docv_terms_v4` score `0.83` says `10 days`.
- No `supersedes_doc_version_id` linkage.
- Flags: `conflicting_evidence=true`, `stale_only_evidence=false`.

Detected class:
- `NUMERIC_WINDOW_CONFLICT`.

Outcome:
- `NEEDS_REVIEW` (must not silently pick one terms version).

### Scenario 3: Safety/medical with stale-only evidence

Email ask:
- "Do I need physician clearance for this route?"

Evidence pack summary:
- Only `safety_medical` chunks found; all `last_reviewed_at > 180 days`.
- Top score `0.84`.
- Flags: `stale_only_evidence=true`, `conflicting_evidence=false`.

Detected class:
- No direct conflict class; stale-only sensitive rule applies.

Outcome:
- `NEEDS_REVIEW`.

### Scenario 4: Itinerary vs FAQ logistics mismatch

Email ask:
- "What time is check-in on June 14?"

Evidence pack summary:
- `trip_itinerary` chunk `06:00` score `0.91`.
- `faq` chunk `08:00` score `0.80`.
- Flags: `conflicting_evidence=false` after precedence handling.

Detected class:
- `ITINERARY_LOGISTICS_CONFLICT` candidate resolved by precedence.

Outcome:
- `OK_TO_DRAFT` with itinerary citation and optional note that FAQ is general guidance.

### Scenario 5: Refund exception request

Email ask:
- "We missed the refund deadline by one day. Can you make an exception?"

Evidence pack summary:
- `structured_policy` and `terms_policy` both confirm deadline policy.
- Scores above `0.72`; no retrieval conflict.
- Flags: `exception_request=true`.

Detected class:
- `EXCEPTION_REQUEST`.

Outcome:
- `NEEDS_REVIEW` (operator discretion required; no automated promise).

### Scenario 6: Out-of-scope legal guarantee request

Email ask:
- "Can you guarantee in writing that no weather-related disruptions will occur?"

Evidence pack summary:
- No authoritative chunk satisfies request; top match score `0.61` (< `0.65`).
- Flags: `no_evidence_found`, `low_confidence=true`.

Detected class:
- `OUT_OF_SCOPE_REQUEST`.

Outcome:
- `UNKNOWN` (chosen because no evidence meets threshold; optional operator follow-up may still occur).

## 8) Acceptance checklist (docs-only)

- Every escalation outcome emits at least one reason code.
- Every reason code maps to evidence locators, except `NO_EVIDENCE_FOUND` where no locator exists by definition.
- Sensitive + stale-only evidence always routes to `NEEDS_REVIEW`.
- Conflicts without supersedes linkage are never silently resolved.
- Unknown threshold behavior follows Step 7.5 (`unknown` when no chunk `>= 0.65`).
