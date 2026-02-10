# Phase 8 Operator Review UX (Gmail-first, v1)

## 1) Overview
Purpose: keep the operator in control for sensitive threads, prevent dangerous commitments, and make review fast and explainable inside Gmail workflow.

This spec operationalizes:
- `docs/decisions/0006-phase-8-guardrails-human-review-trust.md` (DR-0006)
- `docs/phases/phase-8-guardrails/classification-policy-v1.md`
- `docs/phases/phase-8-guardrails/guardrail-taxonomy-examples-v1.md`

Outcome-to-UX state mapping:
- `✅` Auto-draft OK: normal draft flow with lightweight issue feedback.
- `🟡` Review required: safe holding draft + internal guidance + explainability + quick controls.
- `⛔` Blocked: no AI draft, escalate-now workflow, expanded explainability.

## 2) Surfaces (where this appears)
Gmail-first surfaces (conceptual; no code):
- Thread review panel (add-on/sidebar area):
  - Primary location for outcome badge, internal bullets, why-flagged explanation, and controls.
- Draft composer behavior:
  - `✅`: full draft available in composer.
  - `🟡`: safe holding draft prefilled in composer, operator-editable.
  - `⛔`: no AI draft inserted.
- Notification affordances:
  - Status badge shown in our panel only.
  - No Gmail label automation is introduced by this step.

## 3) UX states by outcome

### ✅ Auto-draft OK
- Show normal draft experience and evidence/citation behavior as defined by Phase 7 docs.
- Keep optional quick feedback control: `Should have been flagged`.
- Do not show escalate-now panel.

### 🟡 Review required (core)
Component order in panel (top to bottom):
1. Status header (`🟡 Review required`)
2. Safe holding reply draft (guest-facing)
3. Internal bullets panel (operator-only)
4. Why flagged section (collapsed by default)
5. Controls row (single-click actions)

#### A) Safe holding reply draft (guest-facing)
Requirements:
- Short, calm, non-committal, operator-editable.
- Maximum 4 sentences.
- Must not violate DR-0006 forbidden commitments.
- Operator must verify facts before sending and never promise outcomes.

Template 1: Refund/compensation
"Thanks for reaching out. I’ve shared your request with our team for review under our policy workflow. We’ll follow up directly with next steps after we complete that review."

Use when:
- Refund, chargeback, credit, or compensation intent is detected.

Template 2: Policy exception / booking change
"Thanks for the details. I’ve routed your request to our operations team to review availability and policy requirements. We’ll confirm options and next steps with you as soon as possible."

Use when:
- Exception request, reschedule, itinerary change, or commitment request is detected.

Template 3: Legal/medical/safety non-urgent
"Thanks for sharing this. I’ve escalated your message to the appropriate team for review and follow-up. We can share policy/process next steps, and a team member will contact you directly."

Use when:
- Non-urgent legal, medical, or safety issue requires human review.
- Must not include medical advice, legal advice, or admissions.

#### B) Internal bullets panel (operator-only)
Panel content (fixed structure):
- Guest request summary (1-2 lines).
- Info needed checklist (3-7 bullets).
- Recommended next steps (3-7 bullets).
- Suggested escalation target (`Ops manager`, `Safety lead`, `Billing`, `Legal/management`, `PR owner`).
- Top citations (conceptual links to relevant operator docs/policies).

Presentation rules:
- Internal only, never guest-facing.
- Each bullet should be actionable and scannable.

#### C) Why flagged? (collapsed by default)
Display:
- Primary category + current outcome (`🟡`).
- Key signals:
  - Rule IDs (if available).
  - AI confidence band (`high`, `medium`, `low`).
- Plain-English explanation (1-2 sentences).
- Footer note: `This explanation is operator-visible only.`

#### D) Controls
Single-click controls:
- `Mark as Safe` (override; `🟡` only):
  - Reclassifies this message to `✅` for this message only.
  - Enables full draft generation for this message.
  - Optional reason dropdown allowed, but can be skipped.
- `Should have been flagged` (feedback; all outcomes):
  - Captures expected category/outcome + optional note.
- `Escalate` quick actions (conceptual):
  - Example actions: `Forward to manager`, `Route to safety lead`, `Route to billing`.

Audit note:
- Overrides and feedback actions must emit audit events (detailed schema handled in Phase 8.4).

### ⛔ Blocked (core)
Component order in panel (top to bottom):
1. Status header (`⛔ Blocked`)
2. No-draft notice
3. Escalate-now panel (expanded by default)
4. Why flagged section (expanded by default)
5. Feedback controls

#### A) No draft is generated
- Display explicit message: `Drafting is blocked for safety. Escalate now.`
- No AI guest-facing draft is inserted into composer.

#### B) Escalate-now panel (expanded by default)
Operator actions by category:
- Urgent safety/medical:
  - Contact on-call lead immediately.
  - Contact emergency services when indicated.
  - Attempt direct phone contact with guest.
- Legal/liability:
  - Route to management/legal owner.
- Billing/refund dispute with risk signals:
  - Route to billing lead/manager.
- Illegal/bypass/falsification:
  - Refuse path internally and escalate to compliance/management.

Copy guidance:
- Operator-facing only.
- Directive and procedural, not guest-facing.

#### C) Why flagged? (expanded by default)
Display:
- Primary category.
- Urgency (`high`) when present.
- Key triggers (rule IDs/phrases and classifier summary).

Control rules:
- `Mark as Safe` is not available in `⛔` state.
- Show dispute feedback button: `Flagged incorrectly`.

#### D) Guest-facing guidance
- If guest response is required, operator must write manually or use approved macros.
- No AI draft should be provided in `⛔` state.

## 4) Copy rules (microcopy + tone)
- Calm, respectful, and non-defensive tone.
- Never admit fault or liability.
- Never promise refunds, credits, compensation amounts, or policy exceptions.
- Never provide medical or legal advice.
- Holding replies must be 4 sentences or fewer.

## 5) Accessibility + usability requirements (v1)
- Full keyboard navigation for panel sections and controls.
- Status shown with text + icon (`✅`, `🟡`, `⛔`), not color-only.
- Clear heading hierarchy and section labels.
- Why-flagged content must be scannable:
  - short bullets
  - concise explanation lines
- Buttons have clear labels and visible focus states.

## 6) Feedback and learning loop (conceptual)
Feedback captures:
- `Mark as Safe` (`🟡` only):
  - override decision
  - optional reason
  - message/thread identifiers
- `Should have been flagged` (all outcomes):
  - operator-selected missed category/outcome
  - optional free-text note
- `Flagged incorrectly` (`⛔` state):
  - dispute signal
  - optional explanation

These feedback signals feed later evaluation/tuning workflows; they do not auto-change global policy.

## 7) Edge cases
- Multiple sensitive categories in one message:
  - Show one primary category plus `Also detected` list.
- Thread context escalation:
  - If older thread details plus current message imply urgency, escalate based on current policy outcome.
- Multi-language emails:
  - Same classification policy applies; localized templates are future enhancement.
- Operator edits draft into forbidden territory:
  - Future UI should warn pre-send (deferred); this step documents requirement only.

## 8) Non-goals
- No auto-sending.
- No automatic refunds, policy exceptions, or medical/legal guidance.
- No background outreach to guests.
- No Gmail label mutation in this step.
