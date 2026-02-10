# Unknown & Evaluation v1 (Never Invent Policy)

## 0) Objective

- Unknown handling must be safe, deterministic, and operator-friendly.
- The product must measurably reduce unsupported claims and invented policy.
- Define explicit grounding success criteria and how we prove them.

Alignment:
- Policy-like citation requirements follow `docs/phases/phase-7-knowledge/chunking-and-citations-v1.md`.
- Confidence thresholds and retrieval flags follow `docs/phases/phase-7-knowledge/retrieval-and-ranking-v1.md`.
- Escalation outcomes and reason-code semantics follow `docs/phases/phase-7-knowledge/conflict-and-staleness-handling-v1.md`.

## 1) Definitions

- unknown:
  - No eligible evidence meets unknown threshold (`no chunk >= 0.65` confidence from Step 7.5), or request is out-of-scope for available knowledge.
- unsupported claim:
  - Any policy-like sentence without at least one citation/evidence locator (per Step 7.4).
- grounded draft:
  - Draft where all policy-like claims are backed by eligible citations and precedence-compliant evidence.
- operator accept / minimal edit:
  - Operator sends draft with no edits or only superficial edits (tone/format) that do not change policy meaning.
- escalation outcomes (from Step 7.6):
  - `OK_TO_DRAFT`, `ASK_CLARIFYING_QUESTION`, `NEEDS_REVIEW`, `UNKNOWN`.

## 2) Unknown rules (hard constraints)

Hard rules:
- MUST NEVER assert a policy-like claim without `>= 1` citation.
- If no chunk has `confidence_score >= 0.65`, outcome must be `UNKNOWN` or `NEEDS_REVIEW` per matrix context.
- If `low_confidence=true` (top score `< 0.72`) for policy-like claim, outcome must be `ASK_CLARIFYING_QUESTION` or `NEEDS_REVIEW` based on sensitivity.
- If evidence exists but required high-precedence policy categories are missing for a policy-like claim, outcome must be `NEEDS_REVIEW`.
- If topic is sensitive and `stale_only_evidence=true`, outcome must be `NEEDS_REVIEW` (not `UNKNOWN`).
- If `conflict_detected=true`, outcome must be `NEEDS_REVIEW`.

Rule ordering:
1. Apply precedence + required evidence checks.
2. Apply confidence thresholds.
3. Apply staleness/conflict/exception escalation rules.
4. Only then allow content drafting path.

## 3) Safe-drafting behaviors (templates)

Constraints:
- No legal guarantees.
- No promises of exceptions.
- Neutral, concise tone.

`UNKNOWN` template:
- Guest-facing:
  - "Thanks for your question. I can’t verify this from our current records yet."
  - "If you share your booking reference, trip name, and date, I’ll confirm and follow up with the exact policy details."
- Internal note:
  - `reason_codes=[NO_EVIDENCE_FOUND|OUT_OF_SCOPE]`; include retrieval thresholds and missing evidence summary.

`ASK_CLARIFYING_QUESTION` template:
- Guest-facing:
  - "To give you the most accurate answer, could you confirm [trip/date or booking reference]?"
  - "I’ll check the exact policy for your booking and reply right away."
- Internal note:
  - `reason_codes=[LOW_CONFIDENCE_EVIDENCE]`; include top candidate scores and categories.

`NEEDS_REVIEW` template:
- Guest-facing:
  - "Thanks for checking this. I’m confirming the exact details with our team and will follow up shortly."
- Internal note:
  - Include `reason_codes` (for example `CONFLICT_NUMERIC_WINDOW`, `STALE_ONLY_EVIDENCE`, `EXCEPTION_REQUEST`) and evidence locator list.

`OK_TO_DRAFT` template discipline:
- Guest-facing draft may provide policy answer.
- Internal reminder:
  - Every policy-like sentence must map to at least one citation object (`doc_title`, `source_locator`, `chunk_id`, `confidence_score`).

## 4) Instrumentation plan (what we will log later)

Events (docs-only plan):
- `knowledge.retrieval_completed`
- `knowledge.evidence_pack_built`
- `knowledge.draft_generated`
- `knowledge.escalation_triggered`
- `knowledge.unsupported_claim_detected` (future linter/integrity check)

Required fields per event:
- `tenant_id`
- `thread_id` and/or `message_id` (provider-agnostic ids)
- `categories_used` (list)
- `evidence_pack_size`
- `top_confidence_score`
- `stale_only_evidence` (bool)
- `conflicting_evidence` (bool)
- `outcome` (`OK_TO_DRAFT` | `ASK_CLARIFYING_QUESTION` | `NEEDS_REVIEW` | `UNKNOWN`)
- `reason_codes` (list)
- `latency_ms` (retrieval, evidence-pack, generation stages)

Logging constraint:
- No raw document content or guest PII in telemetry.

## 5) Evaluation plan (offline + online)

### 5.1 Offline evaluation set (v1)

- Build tenant-specific labeled set of `50-200` representative emails (start with `50`).
- Label fields per example:
  - intent/topic
  - sensitivity (`yes/no`)
  - expected gold categories (for example `terms_policy`, `structured_policy`)
  - expected escalation outcome (`OK`/`ASK`/`REVIEW`/`UNKNOWN`)
  - required citations (minimum doc + locator)
- Labeling workflow:
  - Primary labeling by operator-domain reviewer.
  - Secondary internal review for consistency and rubric drift control.

### 5.2 Retrieval quality metrics

Metrics and initial targets:
- `Recall@10` (at least one gold chunk retrieved): target `>= 0.85`.
- `Precision@10`: target `>= 0.50`.
- Coverage (`% emails with >=1 relevant chunk`): target `>= 0.85`.
- Stale-only rate: monitor trend (no hard v1 target; should decline over time).

### 5.3 Groundedness metrics (draft quality)

Metrics and targets:
- Policy citation coverage (`% policy-like sentences with citations`): target `>= 0.95`.
- Unsupported claim rate: target `<= 0.05`.
- Invented policy incident rate: target `0` in eval set.
- Escalation correctness (`% sensitive emails correctly routed to NEEDS_REVIEW when required`): target `>= 0.95`.

### 5.4 Operator workflow metrics (online)

Operational outcome metrics:
- Draft acceptance rate (sent with minimal edits): target `>= 0.60` initially.
- Median time-to-send reduction: target `>= 30%`.
- `Needs review` rate tracked by topic to balance trust and product value.

## 6) Evidence gate (Phase 7 success definition)

Go/no-go checklist:
- Groundedness threshold met: policy citation coverage `>= 0.95`.
- Invented policy threshold met: incident rate `= 0` on evaluation set.
- Retrieval coverage threshold met: coverage `>= 0.85` and Recall@10 `>= 0.85`.
- Escalation correctness threshold met: `>= 0.95` for sensitive-required reviews.
- Latency placeholder met: p95 retrieval `< 1.5s` excluding generation.

## 7) Worked examples

### Example 1: UNKNOWN due to no evidence

Input email:
- "Can you guarantee there will be zero weather delays on our trek?"

Evidence pack signals:
- Top confidence `0.61` (`< 0.65`).
- `evidence_pack_size=0` authoritative chunks.
- Flags: `low_confidence=true`, `no_evidence_found=true`.

Outcome + reason codes:
- Outcome: `UNKNOWN`
- Reason codes: `NO_EVIDENCE_FOUND`, `OUT_OF_SCOPE`

Draft template used:
- UNKNOWN template (guest asks for booking/trip/date, promises confirmation only after verification).

### Example 2: ASK_CLARIFYING_QUESTION due to low confidence

Input email:
- "Can my child join this trip?"

Evidence pack signals:
- Top confidence `0.69` (between `0.65` and `0.72`).
- Weak matches across `faq` and generic itinerary, no precise age rule for specific trip.
- Flags: `low_confidence=true`, `conflicting_evidence=false`.

Outcome + reason codes:
- Outcome: `ASK_CLARIFYING_QUESTION`
- Reason code: `LOW_CONFIDENCE_EVIDENCE`

Draft template used:
- ASK template asking for trip/date and participant age before policy assertion.

### Example 3: NEEDS_REVIEW due to sensitive stale-only evidence

Input email:
- "Do I need medical clearance for this departure?"

Evidence pack signals:
- Top confidence `0.84` but all chunks stale (`last_reviewed_at > 180 days`).
- Flags: `stale_only_evidence=true`, `conflicting_evidence=false`.

Outcome + reason codes:
- Outcome: `NEEDS_REVIEW`
- Reason code: `STALE_ONLY_EVIDENCE`

Draft template used:
- NEEDS_REVIEW holding response + internal note with medical policy locators.

### Example 4: NEEDS_REVIEW due to conflict

Input email:
- "What is the cancellation deadline?"

Evidence pack signals:
- Two `terms_policy` versions both high-confidence (`0.84`, `0.83`) with conflicting numeric windows and no supersedes linkage.
- Flags: `conflicting_evidence=true`.

Outcome + reason codes:
- Outcome: `NEEDS_REVIEW`
- Reason code: `CONFLICT_NUMERIC_WINDOW`

Draft template used:
- NEEDS_REVIEW template with internal evidence list for operator adjudication.

## 8) Acceptance checklist (docs-only)

- Unknown rules are explicit (`MUST`/`NEVER`) and consistent with Step 7.5 and Step 7.6 thresholds/outcomes.
- Templates exist for `UNKNOWN`, `ASK_CLARIFYING_QUESTION`, `NEEDS_REVIEW`, and `OK_TO_DRAFT` discipline.
- Metrics cover retrieval quality, groundedness quality, and operator workflow outcomes with initial targets.
- Evidence gate checklist exists and is measurable.
