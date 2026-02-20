# DR-0006: Phase 8 — Guardrails & Human Review (Trust)

## Status
Accepted

## Context
- Gmail-first drafting requires explicit trust boundaries: drafts are suggested text inside live customer threads and must never act like autonomous decisions.
- Guardrails are a policy engine, not a model feature. Classification and outcomes must be deterministic at the decision layer even when AI assistance is used.
- This Decision Record freezes Phase 8 guardrail categories, outcome matrix, forbidden commitments, and key tradeoffs so implementation stays consistent across API, worker, and admin surfaces.

## Decisions (frozen)
1. Outcomes are fixed to a three-level policy result:
   - ✅ Auto-draft OK.
   - 🟡 Review required: generate a safe holding reply and internal bullets; no commitments.
   - ⛔ Blocked: no draft; show escalate-now guidance.

2. Classification is hybrid and policy-led:
   - Rules-first deterministic triggers for high-precision/hard-stop handling.
   - AI-assisted classifier second for semantic intent and confidence.
   - Policy engine decides the final outcome.
   - Rules always win for hard triggers.

3. Guardrail taxonomy for outdoor/adventure operators is fixed to:
   - Safety & incident response
   - Medical & health
   - Legal/liability/admissions
   - Refunds/chargebacks/compensation
   - Policy exceptions & special accommodations
   - Booking changes & operational commitments
   - Compliance/permits/border documents
   - Payments/PII/PCI
   - Harassment/threats/discrimination
   - PR/media escalation

4. Guardrail decision matrix is fixed as:

| Category | Examples | Outcome | AI allowed / not allowed |
|---|---|---:|---|
| Routine logistics | meeting point, packing list, itinerary reminders, meal info | ✅ | Allowed: factual info from operator docs |
| Simple pricing/availability | “What’s included?”, “Is June available?” | ✅ | Allowed: cite inventory/policy; avoid guarantees |
| Minor booking admin | resend confirmation, clarify dates (no changes) | ✅ | Allowed: procedural guidance |
| Policy clarification (no exception) | “What’s your cancellation policy?” | ✅ | Allowed: quote policy; no discretion |
| Refund/compensation request | “I want a refund”, “credit me”, “chargeback” | 🟡 | Forbidden: promise refund/amount; Allowed: acknowledge + route to policy workflow |
| Policy exception request | “Can you waive the fee?”, “Can my 12yo join?” | 🟡 | Forbidden: granting exceptions; Allowed: request details + escalate |
| Operational commitment change | reschedule, swap itinerary, private guide request | 🟡 | Forbidden: guarantees; Allowed: collect constraints + confirm next steps |
| Medical/health | allergies, meds, pregnancy, symptoms | 🟡 (or ⛔ if urgent) | Forbidden: diagnosis/treatment; Allowed: safety disclaimer + consult clinician + operator policy |
| Safety incident (non-urgent) | minor injury report after trip | 🟡 | Forbidden: admissions of fault; Allowed: empathy + collect details + escalate |
| Safety emergency (urgent) | “We’re lost”, “injured now”, “SOS” | ⛔ | No drafting; show emergency instructions + call operator on-call |
| Legal threats / waiver disputes | “my lawyer…”, “sue”, “negligence” | 🟡 | Forbidden: legal advice/admissions; Allowed: acknowledge + escalate |
| Payments/PII | credit card numbers, ID scans, bank details | 🟡 | Forbidden: storing/echoing PII; Allowed: instruct secure channel + redact |
| Harassment/threats | abusive language, threats, discrimination claims | 🟡 (⛔ if violent threat) | Allowed: de-escalation template + escalate |
| Media/PR | journalists, viral posts, influencer demands | 🟡 | Forbidden: official statements; Allowed: route to PR owner |
| Illegal / bypass permits | “help me sneak in / falsify” | ⛔ | Refuse + escalate |

5. AI forbidden commitments list is frozen:
   - Admit fault, negligence, or liability
   - Promise refunds/credits/compensation or quote amounts without an approved workflow
   - Grant policy exceptions without human approval
   - Provide medical diagnosis/treatment instructions
   - Provide legal advice or interpret liability/waivers as counsel
   - Provide instructions that materially increase risk (dangerous route guidance, ignore warnings, etc.)
   - Request, store, or repeat full payment credentials or sensitive IDs

## Consequences
- Conservative routing reduces catastrophic trust failures but increases review volume.
- Hybrid classification improves recall for nuanced sensitive cases but adds policy/classifier orchestration complexity.
- Privacy posture should prefer minimal raw content storage (redaction plus hashes); full implementation detail is deferred to later steps.
