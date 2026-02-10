# Phase 8 Audit Logging and Privacy (v1)

## 1) Principles
This spec defines how guardrail and review events are logged so outcomes are explainable and measurable while minimizing sensitive data storage. It operationalizes:
- `docs/decisions/0006-phase-8-guardrails-human-review-trust.md` (DR-0006)
- `docs/phases/phase-8-guardrails/classification-policy-v1.md`
- `docs/phases/phase-8-guardrails/operator-review-ux-v1.md`

Frozen principles:
- Explainability: every `🟡`/`⛔` decision must be attributable to rule IDs, AI labels, and policy versions.
- Minimize raw content: default to hashes and redacted snippets; never store full payment credentials or sensitive IDs.
- Tenant isolation: every event is scoped by `tenant_id` and tenant-bound identifiers.
- Versioned behavior: include `policy_version`, `ruleset_version`, `classifier_version`, and prompt/template versions where applicable.
- Human-in-control: operator actions (view/edit/discard/override/feedback/send when detectable) must be logged.

## 2) Data classification and redaction policy (v1)
### Sensitive data classes
Sensitive content includes:
- PCI/payment: card numbers, CVV, bank account/routing details.
- Government IDs: passport numbers, driver license IDs, national ID numbers.
- Medical info: symptoms, diagnoses, medication details.
- Legal threat content: lawsuit threats, negligence/fault allegations.
- PII: email addresses, phone numbers, physical addresses.

### Redaction rules
- Always redact card-like and ID-like patterns from stored text fields.
- Store card last-4 only if operationally required; default preference is storing none.
- Redact email and phone fields/snippets by default:
  - email example: `***@***.com`
  - phone example: `(***)***-****`
- Redact long numeric sequences that match ID/payment heuristics.
- Never store CVV/security codes.

### Hashing policy
- Store content hashes, not full raw bodies, for decision reproducibility:
  - `message_content_hash`
  - `draft_content_hash`
- Hash algorithm: `sha256`.
- Evidence/document hash lineage follows Phase 7 concepts (doc/chunk/version hash discipline).

### Snippet policy
- Optional `redacted_snippet` can be stored only for debugging context:
  - max length: `<= 240` chars.
  - must pass redaction rules before persistence.
- For `⛔` safety emergency outcomes:
  - do not store snippet by default.
  - store category, urgency, and trigger metadata only.

## 3) Event taxonomy
### Ingestion and processing events
- `email.received`
- `classification.completed`
- `draft.generated` (only for `✅` full draft and `🟡` holding reply/internal artifacts)
- `draft.withheld` (`⛔`, includes reason category + urgency)

### Operator interaction events
- `ui.panel.viewed`
- `operator.override.mark_safe` (`🟡` only)
- `operator.feedback.should_have_been_flagged`
- `operator.feedback.flagged_incorrectly` (`⛔` only)
- `operator.draft.edited`
- `operator.draft.discarded`
- `operator.draft.sent` (when detectable; provider-dependent, otherwise deferred)
- `operator.escalation.initiated` (future UX action; event reserved now)

## 4) Event schemas (fields per event)
### Common required fields (all events)
| Field | Type | Notes |
| --- | --- | --- |
| `event_type` | enum | One value from taxonomy above |
| `tenant_id` | string | Required tenant scope |
| `mailbox_id` | string | Tenant mailbox id |
| `provider` | enum | `gmail` in v1 |
| `thread_id` | string | Provider thread ref mapped to canonical id |
| `message_id` | string | Provider/canonical message ref |
| `occurred_at` | timestamp | UTC ISO-8601 |
| `actor` | enum | `system` or `operator` |
| `request_id` | string | Per-request correlation |
| `trace_id` | string | Cross-service trace correlation |

### Classification and decision fields (when applicable)
| Field | Type | Notes |
| --- | --- | --- |
| `final_outcome` | enum | `✅` / `🟡` / `⛔` |
| `primary_category` | string | Category from Phase 8 taxonomy |
| `all_categories` | string[] | Multi-label categories |
| `urgency` | enum | `none` / `low` / `high` |
| `rule_matches` | object[] | `[{rule_id, severity}]`; no raw match text |
| `ai_labels` | object[] | `[{category, confidence_band}]` |
| `ai_explanation_short` | string | Short redacted explanation only |
| `policy_version` | string | Required |
| `ruleset_version` | string | Required |
| `classifier_version` | string | Required |

### Draft generation fields (when applicable)
| Field | Type | Notes |
| --- | --- | --- |
| `draft_id` | string | Present for generated drafts |
| `draft_kind` | enum | `full` / `holding_reply` / `internal_bullets` / `none` |
| `draft_content_hash` | string | `sha256` hash |
| `template_id` | string | Required for holding reply template outputs |
| `prompt_version` | string | Generation prompt/template version |
| `citations` | string[] | Citation ids only |
| `evidence_doc_version_ids` | string[] | Doc version ids only |

### Operator action fields (when applicable)
| Field | Type | Notes |
| --- | --- | --- |
| `action` | enum | `viewed` / `edited` / `discarded` / `override` / `feedback` / `sent` / `escalated` |
| `before_outcome` | enum | Required for override/feedback |
| `after_outcome` | enum | Required for override/feedback |
| `override_reason_code` | enum | Controlled vocab; optional |
| `override_reason_note` | string | Optional; redact before persistence |
| `feedback_category` | string | Suggested missed/incorrect category |
| `feedback_note` | string | Optional free text, redacted |

### Event-specific minimum payloads
| Event type | Required extras beyond common fields |
| --- | --- |
| `email.received` | `message_content_hash`, optional `redacted_snippet` |
| `classification.completed` | classification/decision fields + versions |
| `draft.generated` | `draft_id`, `draft_kind`, `draft_content_hash`, `template_id` when applicable |
| `draft.withheld` | `final_outcome=⛔`, `primary_category`, `urgency`, `rule_matches` |
| `ui.panel.viewed` | `action=viewed`, `final_outcome`, `primary_category` |
| `operator.override.mark_safe` | `action=override`, `before_outcome=🟡`, `after_outcome=✅`, optional reason fields |
| `operator.feedback.should_have_been_flagged` | `action=feedback`, `feedback_category`, optional note |
| `operator.feedback.flagged_incorrectly` | `action=feedback`, `before_outcome=⛔`, optional note |
| `operator.draft.edited` | `action=edited`, `draft_id`, `draft_content_hash` |
| `operator.draft.discarded` | `action=discarded`, `draft_id` |
| `operator.draft.sent` | `action=sent`, `draft_id` (when detectable) |
| `operator.escalation.initiated` | `action=escalated`, `primary_category`, `escalation_target` |

### Example JSON (docs only)
`classification.completed`
```json
{
  "event_type": "classification.completed",
  "tenant_id": "ten_123",
  "mailbox_id": "mbx_123",
  "provider": "gmail",
  "thread_id": "thr_abc",
  "message_id": "msg_abc",
  "occurred_at": "2026-02-10T16:21:00Z",
  "actor": "system",
  "request_id": "req_01",
  "trace_id": "tr_01",
  "final_outcome": "🟡",
  "primary_category": "Refunds/chargebacks/compensation",
  "all_categories": ["Refunds/chargebacks/compensation"],
  "urgency": "none",
  "rule_matches": [{"rule_id": "refund_request_v1", "severity": "high"}],
  "ai_labels": [{"category": "Refunds/chargebacks/compensation", "confidence_band": "high"}],
  "ai_explanation_short": "Guest is requesting refund and chargeback path.",
  "policy_version": "v1",
  "ruleset_version": "2026-02-10.r1",
  "classifier_version": "cls-v1.0"
}
```

`draft.withheld`
```json
{
  "event_type": "draft.withheld",
  "tenant_id": "ten_123",
  "mailbox_id": "mbx_123",
  "provider": "gmail",
  "thread_id": "thr_urgent",
  "message_id": "msg_urgent",
  "occurred_at": "2026-02-10T16:21:05Z",
  "actor": "system",
  "request_id": "req_02",
  "trace_id": "tr_02",
  "final_outcome": "⛔",
  "primary_category": "Safety & incident response",
  "all_categories": ["Safety & incident response"],
  "urgency": "high",
  "rule_matches": [{"rule_id": "safety_emergency_sos_v1", "severity": "critical"}],
  "policy_version": "v1",
  "ruleset_version": "2026-02-10.r1",
  "classifier_version": "cls-v1.0"
}
```

`operator.override.mark_safe`
```json
{
  "event_type": "operator.override.mark_safe",
  "tenant_id": "ten_123",
  "mailbox_id": "mbx_123",
  "provider": "gmail",
  "thread_id": "thr_abc",
  "message_id": "msg_abc",
  "occurred_at": "2026-02-10T16:22:14Z",
  "actor": "operator",
  "request_id": "req_03",
  "trace_id": "tr_03",
  "action": "override",
  "before_outcome": "🟡",
  "after_outcome": "✅",
  "override_reason_code": "known_false_positive",
  "override_reason_note": "Reviewed booking policy context; safe to proceed.",
  "policy_version": "v1",
  "ruleset_version": "2026-02-10.r1",
  "classifier_version": "cls-v1.0"
}
```

## 5) Retention and access
Frozen defaults:
- Retention default: 18 months.
- Tenant-configurable retention: deferred future capability.

Access model:
- Role-based access only:
  - tenant admins
  - authorized internal support roles
- Tenant audit export: future capability.

Deletion model:
- Tenant offboarding triggers purge workflow/schedule (future implementation detail).

## 6) False positive / false negative handling loop
UX feedback to learning signals:
- `operator.override.mark_safe` -> false-positive candidate signal.
- `operator.feedback.should_have_been_flagged` -> missed-flag/recall signal.
- `operator.feedback.flagged_incorrectly` (`⛔`) -> precision dispute signal.

Conceptual periodic guardrail report metrics:
- Review rate: `% of messages classified as 🟡`.
- Override rate: `% of 🟡 marked safe by operators`.
- Flagged incorrectly rate: `% of ⛔ with dispute feedback`.
- Missed flag rate: `% of non-flagged messages receiving should-have-been-flagged feedback`.

Ground-truth labeling and adjudication plan is defined in Step 8.6.

## 7) Debugging without privacy leakage
- Debug with hashes, version fields, rule IDs, confidence bands, and event timelines.
- Use redacted snippets only when required and permitted by policy.
- Do not rely on raw body storage for standard debugging workflows.

## 8) Non-goals
- No full raw email body storage by default.
- No attachment storage changes beyond existing Phase 7 storage systems.
- No automated enforcement actions beyond classification outcomes.
