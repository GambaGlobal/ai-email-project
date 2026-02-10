# Phase 8 Tenant Customization Boundaries (v1)

## 1) Principles
This document defines which guardrail settings tenants may customize in v1 without weakening trust guarantees.

References:
- `docs/decisions/0006-phase-8-guardrails-human-review-trust.md` (DR-0006)
- `docs/phases/phase-8-guardrails/classification-policy-v1.md`
- `docs/phases/phase-8-guardrails/operator-review-ux-v1.md`
- `docs/phases/phase-8-guardrails/audit-logging-and-privacy-v1.md`
- `docs/phases/phase-8-guardrails/golden-dataset-and-evaluation-v1.md`

Frozen principles:
- Tenants can tune workflow efficiency, but cannot weaken safety.
- `⛔` blocked outcomes remain blocked regardless of tenant settings.
- Rules are authoritative and non-downgrading.
- Every customization and change is auditable.

## 2) Configurable knobs (v1) - explicitly allowed
### A) Safe sender/domain allowlist (review suppression ceiling)
- Name: `safe_sender_allowlist`
- Purpose: reduce unnecessary review for trusted external senders/domains.
- Default: empty.
- Constraints:
  - domain entries only (no wildcard local-part rules).
  - max `200` domains.
  - cannot bypass `⛔` outcomes.
  - can only influence `🟡 -> ✅` for non-critical categories when rules do not require escalation.
- Validation:
  - valid domain format required.
  - deduplicated, normalized lowercase.
  - every change emits audit event.
- Example:
  - `partner-lodge.example` reduces review noise for routine logistics only.

### B) Topic hints / custom keywords (classification hints)
- Name: `classification_topic_hints`
- Purpose: improve semantic recognition of tenant-specific terms (trip names, route names, internal acronyms).
- Default: empty.
- Constraints:
  - max `100` hints.
  - hints are context-only signals.
  - hints cannot encode "always safe" or bypass directives.
- Validation:
  - block phrases such as `always approve`, `never flag`, `ignore safety`.
  - trim length and reject malformed/empty tokens.
- Example:
  - adding `Glacier Traverse A` helps category routing but does not force `✅`.

### C) Holding reply template selection
- Name: `holding_reply_template_variant`
- Purpose: choose approved tone/voice variant for `🟡` holding replies.
- Default: `system_default_v1`.
- Constraints:
  - selection only from approved system template variants.
  - no free-form template authoring in v1.
  - template must comply with DR-0006 forbidden commitments.
- Validation:
  - enforce approved template id list.
  - lint for prohibited commitment patterns before publishing variants.
- Example:
  - select `friendly_concise_v1` instead of `neutral_formal_v1`.

### D) Escalation routing labels (internal)
- Name: `category_escalation_routes`
- Purpose: map category -> internal owner label for operator panel guidance.
- Default:
  - safety -> `Safety lead`
  - legal -> `Management/Legal`
  - refunds -> `Billing`
- Constraints:
  - UI-routing only; does not change outcome/classification.
- Validation:
  - required label per configurable category.
  - max label length and allowed character set.
- Example:
  - refunds route changed from `Billing` to `Guest Care Finance`.

### E) Review queue preferences (UI)
- Name: `review_queue_preferences`
- Purpose: operator triage preferences (sort/group behavior).
- Default: sort by `urgency desc`, then `newest`.
- Constraints:
  - UI ordering only.
  - cannot suppress display of `⛔` items.
- Validation:
  - allowed sort keys: `urgency`, `category`, `received_at`.
- Example:
  - group by category with urgency pinned first.

## 3) Non-configurable hard boundaries (forbidden in v1)
Tenants cannot modify:
- Outcome model (`✅` / `🟡` / `⛔`).
- Guardrail matrix outcomes for critical categories, including blocked triggers.
- AI forbidden commitments list.
- Rules non-downgrading policy.
- Urgency override behavior for Safety/Medical.
- Redaction policy requirements for PCI/PII/sensitive IDs.

## 4) Ceilings and floors table
| Setting | Can reduce review rate? | Can affect `⛔`? | Can downgrade `🟡 -> ✅`? | Audit required? | Default |
| --- | --- | --- | --- | --- | --- |
| Safe sender/domain allowlist | Yes, limited | No | Yes, non-critical only when rules allow | Yes | Empty |
| Topic hints/custom keywords | Indirect only | No | No direct downgrade authority | Yes | Empty |
| Holding reply template selection | No | No | No | Yes | `system_default_v1` |
| Escalation routing labels | No (workflow only) | No | No | Yes | Category defaults |
| Review queue preferences | No (ordering only) | No | No | Yes | `urgency desc, newest` |

## 5) Change management and audit logging (ties to 8.4)
Each config mutation must emit `tenant.config.updated` with at least:
- `tenant_id`
- `actor`
- `changed_keys[]`
- `before` (redacted/minimal diff-safe snapshot)
- `after` (redacted/minimal diff-safe snapshot)
- `occurred_at`
- `request_id` / `trace_id`

Versioning:
- Maintain `tenant_policy_config_version` on every successful update.
- Include config version in downstream classification/evaluation metadata.

Rollback:
- Store last-known-good config snapshot.
- Allow controlled rollback to prior version (conceptual v1 requirement).

## 6) Evaluation impact (ties to 8.6)
- Record tenant customization state with each evaluation run.
- If review rate decreases materially after config changes, verify critical-category false negatives did not increase.
- Use feedback signals (`Mark as Safe`, `Should have been flagged`, `Flagged incorrectly`) to propose safe config adjustments in future revisions.

## 7) Examples
1. Partner domain allowlisted but refund request still `🟡`:
   - Allowlist cannot bypass refund/chargeback sensitivity.
2. VIP guest allowlisted but legal threat still `🟡`:
   - Legal category remains reviewed regardless of sender trust.
3. Safety emergency always `⛔` regardless of allowlist:
   - Urgency and hard-stop rules override all tenant tuning.
4. Custom trip-name keyword improves routing clarity only:
   - Better primary category confidence, no forced outcome downgrade.
5. Tenant selects friendly holding template variant:
   - Tone changes within approved safe template set; commitments remain prohibited.
6. Operator uses `Mark as Safe` on one message:
   - Applies per message/thread context, not as global tenant policy change.
7. Queue preference changed to category grouping:
   - Operator workflow changes, but classification outcomes are unchanged.

## 8) Non-goals and future work
- Tenant-defined custom guardrail categories (future).
- Tenant-defined rule authoring (future, high risk).
- Per-operator personal override policies (future).
