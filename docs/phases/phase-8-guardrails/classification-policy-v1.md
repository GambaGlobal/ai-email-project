# Phase 8 Classification Policy (v1)

## 1) Overview
This document defines deterministic classification and policy decision behavior for Gmail-first drafting so trust outcomes are consistent, auditable, and implementation-ready. It operationalizes `docs/decisions/0006-phase-8-guardrails-human-review-trust.md` (DR-0006) and uses `docs/phases/phase-8-guardrails/guardrail-taxonomy-examples-v1.md` as the language/examples bank.

Outcomes (authority: DR-0006):
- `✅` Auto-draft OK
- `🟡` Review required
- `⛔` Blocked

## 2) Inputs to classification
The policy engine consumes the following normalized inputs per inbound message:
- Message content:
  - Current guest message text
  - Thread context (prior guest + operator messages)
- Metadata:
  - Sender identity/role, subject, locale/time context
  - Booking identifiers when available (`booking_id`, trip date, itinerary id)
- Retrieved knowledge signals (conceptual only in this phase):
  - Retrieved document categories
  - Retrieval confidence signals
  - Citation presence/absence indicators
- Deterministic rules outputs:
  - List of matched rule ids + severities
- AI-assisted classifier outputs:
  - Multi-label category predictions + confidence
  - Primary category
  - Urgency signal

## 3) Rules layer (deterministic)
A rule is a deterministic pattern/heuristic (keyword, phrase pattern, structural signal, or metadata condition) used for high-precision trust protection and explainability.

Rules output contract:
- `rule_matches[]` with each match shaped as:
  - `{rule_id, category, severity, recommended_outcome, rationale}`

Severity scale:
- `low`
- `medium`
- `high`
- `critical`

Hard-stop rule classes (must force at least `🟡`, and often `⛔`):
- Safety emergency indicators:
  - Examples: `SOS`, `we are lost now`, `injured and bleeding`, `need rescue`
- Medical urgent indicators:
  - Examples: `can't breathe`, `chest pain now`, `fainted`, `severe allergic reaction`
- Legal threat indicators:
  - Examples: `my lawyer`, `sue`, `negligence`, `admit fault`
- Refund/chargeback indicators:
  - Examples: `refund me`, `credit me`, `chargeback`, `compensation amount`
- PII/PCI indicators:
  - Examples: full card data, CVV, bank account details, ID scans in-thread
- Illegal/bypass indicators:
  - Examples: falsify permits, bypass checkpoint, evade required legal documents

Frozen rule authority principle:
- Rules may escalate but never downgrade.
- AI cannot override rule-driven escalation to a lower outcome.

## 4) AI-assisted classifier layer (semantic)
Purpose:
- Capture nuanced intent and edge-case semantics not reliably caught by deterministic rules.

Classifier output contract:
- `ai_labels[]`: multi-label list of `{category, confidence}`
- `primary_category`: single best category label
- `urgency`: `none | low | high`
- `notes`: short internal rationale for operator visibility (not guest-facing)

Frozen confidence bands:
- `high_confidence >= 0.80`
- `medium_confidence 0.65-0.79`
- `low_confidence < 0.65`

## 5) Policy engine (final decision logic)
The policy engine emits exactly one final outcome and one primary category per message.

### Step A - Start from DR-0006 matrix
Map candidate category to default outcome:
- Default `✅`: routine logistics, simple pricing/availability, minor booking admin, policy clarification without exception.
- Default `🟡`: safety incident (non-urgent), medical/health (non-urgent), legal/liability, refunds/chargebacks, policy exceptions, booking commitment changes, payments/PII, harassment/discrimination, PR/media.
- Default `⛔`: safety emergency and illegal/bypass permit requests.

### Step B - Apply rules (authoritative)
- If any rule recommends `⛔`, set current outcome to `⛔`.
- Else if any rule recommends `🟡`, set minimum current outcome to `🟡`.
- Else current outcome remains potentially `✅`.

Invariant:
- Rule output is a floor for severity (`⛔ > 🟡 > ✅`).

### Step C - Apply AI classifier (non-downgrading)
- Derive AI candidate outcome from `primary_category` using DR-0006 matrix.
- If AI confidence is low:
  - If rules already set `🟡` or `⛔`, keep current outcome.
  - If rules allow `✅` but any sensitive label is present in `ai_labels[]`, escalate to `🟡`.
  - Otherwise keep `✅` only for clearly non-sensitive categories.
- If AI candidate is more severe than current outcome, escalate to AI candidate.
- Never downgrade below current outcome.

Sensitive labels for low-confidence escalation include:
- safety, medical, legal/liability, refunds/chargebacks, payments/PII, harassment/threats, policy exceptions, compliance/border risk.

### Step D - Apply urgency override
- If `urgency == high` and category is Safety or Medical, force final outcome `⛔`.

Urgency examples (from examples bank patterns):
- `we're lost now`
- `injured and bleeding`
- `SOS`
- `can't breathe`
- `chest pain now`

### Step E - Tie-breakers and multi-label resolution
Internal multi-label is allowed, but final output must be single-outcome/single-primary-category.

Resolution order:
- Most severe outcome wins: `⛔ > 🟡 > ✅`.
- If multiple categories share same outcome severity, pick primary category by precedence:
  1. Safety & incident response
  2. Medical & health
  3. Legal/liability/admissions
  4. Refunds/chargebacks/compensation
  5. Payments/PII/PCI
  6. Harassment/threats/discrimination
  7. Policy exceptions & special accommodations
  8. Booking changes & operational commitments
  9. Compliance/permits/border documents
  10. PR/media escalation
  11. Routine logistics/pricing/admin (`✅` non-guardrail normal bucket)

## 6) Output contract (downstream)
Normalized decision object (conceptual):

```json
{
  "final_outcome": "✅|🟡|⛔",
  "primary_category": "string",
  "all_categories": ["string"],
  "urgency": "none|low|high",
  "explanations": {
    "rule_explanations": [
      {
        "rule_id": "string",
        "summary": "short rationale"
      }
    ],
    "ai_explanation": "short rationale"
  },
  "versions": {
    "policy_version": "v1",
    "ruleset_version": "string",
    "classifier_version": "string"
  }
}
```

Auditability requirement:
- `policy_version`, `ruleset_version`, and `classifier_version` are mandatory for reproducibility and later audit logging (targeted in Phase 8.4).

## 7) Behavior per outcome (drafting policy linkage)
- `✅` Auto-draft OK:
  - Full draft generation allowed.
  - Still must obey DR-0006 forbidden commitments.
- `🟡` Review required:
  - Generate only a safe holding reply and internal bullets.
  - No commitments (no fault admission, no medical/legal advice, no refund promises, no policy exception grants).
  - Include structured "info needed" checklist for operator follow-up.
- `⛔` Blocked:
  - No guest-facing draft is generated.
  - Show operator escalate-now instructions.

## 8) Non-goals / future work
Out of scope for this document:
- Concrete runtime implementation in API/worker.
- Full rule library authoring and maintenance tooling.
- Evaluation harness and benchmark datasets.
- Admin/reviewer UX wiring and escalation workflows.

This document is the Phase 8 policy source of truth for implementing Rules -> AI-assisted classifier -> Policy Engine behavior without ambiguity.
