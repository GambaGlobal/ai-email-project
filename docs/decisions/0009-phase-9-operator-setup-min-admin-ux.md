# Decision Record: Phase 9 — Operator Setup & Minimal Admin UX (v1)

- **ID:** 0009
- **Phase:** 9 — Operator Setup & Minimal Admin UX (Build)
- **Status:** Proposed (freeze at end of Phase 9 closeout)
- **Date:** 2026-02-12
- **Owners:** Product + Eng

## Context
We are building a Gmail-first AI Inbox Copilot for outdoor/adventure travel operators. The product must remain **human-in-control** (drafts only; never auto-send in v1), operate **inside Gmail**, and prioritize **trust** (clear status, clear failures, safe escalation).

Phase 9’s purpose is a minimal admin/onboarding experience that gets an operator from “new tenant” → “working drafts” quickly, with enough observability that operators and support can diagnose issues without guesswork.

This Decision Record defines what we will (and will not) build for v1 setup/admin UX.

## Phase 9 goal (big outcome)
Operators can:
1) connect Gmail,
2) upload knowledge docs,
3) set tone/policies,
4) see system health,
so they can start generating accurate drafts (still not auto-sent).

## Decision

### 1) Minimal onboarding flow (v1)
We will implement a **4-step onboarding wizard** in the admin app:

1. **Operator Profile**
   - Operator name, timezone, primary contact email (website optional).
2. **Connect Gmail**
   - OAuth connect with clear scope explanation.
   - “Test connection” verifies we can read threads and create drafts.
3. **Upload Docs**
   - Drag/drop docs into simple categories (Policies, Itineraries, FAQs, Packing).
   - Show ingestion progress + per-doc “ready/failed” status.
4. **Defaults + Enable Drafts**
   - Select tone preset (and optional sliders behind “Advanced”).
   - Confirm escalation rules for sensitive topics.
   - Explicit “Enable Drafts” toggle gated by prerequisites.

**Gating:** “Enable Drafts” requires Gmail connected + at least one indexed doc. (Open question: provide a starter knowledge template for operators without docs on day 1.)

### 2) Settings scope: Essential vs Optional
We will separate settings into:
- **Essential (v1):** shown by default; required for value + trust + supportability.
- **Advanced (later):** hidden behind collapsed sections or deferred to later phases.

#### Essential settings (v1)
- Gmail connection status + reconnect
- Sending identity (From name/signature)
- Docs upload + doc categories + ingestion status
- Tone preset + minimal tuning (see below)
- Escalation rules: refund/safety/medical/legal/exceptions → human review
- System health view (R/Y/G status)

#### Optional settings (defer unless proven necessary)
- Topic hints / custom keywords per product line
- Holding reply templates
- Safe sender/domain allowlist
- Business hours / SLA messaging
- CC/BCC defaults
- Multiple brands/voices per tenant
- Multi-user roles/permissions (RBAC)
- Multi-mailbox per tenant
- Deep analytics and experiments

### 3) Tone representation (structured, previewable)
Tone will be represented as a **structured config**, not freeform prompt text.

#### Admin UI (v1)
- **Preset picker (3–5 presets)**, e.g.:
  - Professional & concise
  - Warm & welcoming
  - Friendly expert guide
  - (Optional) Luxury concierge
- **Advanced sliders (collapsed):**
  - Formality (Casual ↔ Formal)
  - Warmth (Direct ↔ Warm)
  - Brevity (Short ↔ Detailed)
  - Confidence language (Hedged ↔ Certain), guardrailed to avoid overpromising
- **Do / Don’t bullets** (short, operator-editable)
- **Live preview** using a sample inbound email → sample draft output (non-sent)

#### Stored model (v1)
- `tone.preset_id`
- `tone.sliders` (0–100 values)
- `tone.dos[]` / `tone.donts[]`

Rationale: structured tone is safer, easier to validate, and more stable than unconstrained prompt editing.

### 4) Error/status visibility (trust requirement)
We will implement a dedicated **System Health** page and show inline status during onboarding.

#### Health cards (R/Y/G)
- **Gmail Connection**
  - Green: connected + can draft
  - Yellow: token expiring soon / reconnect needed
  - Red: disconnected / permissions missing
- **Notifications**
  - Green: watch active; recent notification received
  - Yellow: delayed notifications
  - Red: no notifications received within threshold; action required
- **Knowledge Index**
  - Green: docs indexed; last updated
  - Yellow: indexing in progress
  - Red: indexing failed; show doc(s) with retry guidance
- **Draft Generation**
  - Green: drafts being created
  - Yellow: transient failures / elevated review rate
  - Red: draft pipeline failing; show operator-safe reason category

#### Diagnostics drawer (support-friendly, operator-safe)
- last processed timestamp(s)
- last successful watch/notification timestamp
- recent failure categories (no sensitive email content)
- correlation ID for support

### 5) Explicit v1 exclusions (what NOT to build in Phase 9)
We will not include:
- Billing/subscriptions
- RBAC/roles/permissions
- Multi-mailbox per tenant
- Auto-send or inbox automation (auto-label/archive/respond)
- Deep analytics dashboards
- Website widgets or CRM integrations

## Tradeoffs & consequences
- **Pros:** faster onboarding, lower support burden, clearer trust signals, less configuration fatigue.
- **Cons:** fewer knobs for power users; some operators may want multi-mailbox/roles sooner.
- **Mitigation:** keep “Advanced” placeholders and measure demand during pilots before expanding scope.

## Follow-ups (candidate future work)
- Multi-mailbox support per tenant
- Multi-user roles/permissions
- Holding reply templates + SLA/business hours
- Topic hints/custom keywords
- Expanded analytics and operator reporting

## Open questions (validate during pilots)
- Do we need a “starter template” knowledge pack for operators without docs on day 1?
- Do we support multiple sending identities (aliases) in v1 or later?
- Should we expose only friendly health states or include deeper diagnostics for advanced users?
