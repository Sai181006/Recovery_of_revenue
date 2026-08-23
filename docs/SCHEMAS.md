# Phase 0 schema contract

The versioned TypeScript contract in `src/types.ts` is the executable schema. All records use schema version `1.0`; fixtures compile against it.

- **RecoveryEvent:** immutable source identity and times, merchant/subscription/customer references, lifecycle event, amount/currency, consent/contact/suppression controls, optional retry/update-flow signals, and the untouched raw failure object.
- **MerchantPolicy:** immutable decision snapshot identity, IANA timezone, quiet-hour window, cooldown, per-case contact cap, minimum amount, enabled simulated channels, and trusted-update-link permission.
- **RecoveryCase:** current monotonic subscription projection, case state, point-in-time amount, normalized failure plus raw source fields, contact counters, and latest accepted event.
- **Decision:** exact eligible and prohibited allowlist partitions, selected action, deterministic reason codes, policy version, and selector version.
- **AuditEvent:** append-only event/case/time/kind/detail record for receipt, deduplication, projection, decisions, outbox, and outcomes.
- **Outcome:** event-linked open/recovered/cancelled/suppressed status, optional recovered value, and conservative attribution.
- **WebhookReceipt:** append-only receipt ID, Razorpay event ID, receipt time, verification status, processing status, recursively redacted payload, and optional failure reason. It is persisted before event mapping.

The action enum is exactly `WAIT`, `SEND_GENTLE_REMINDER`, `SEND_ACTION_REQUIRED`, `SURFACE_PAYMENT_UPDATE_LINK`, `ESCALATE_TO_MERCHANT`, and `SUPPRESS`. Optional fields are omitted rather than populated with guessed values.

The advisor input contains only `schemaVersion`, case/subscription state, normalized failure labels, eligible actions, and policy version. Advisor output contains exactly `schemaVersion`, `selectedAction`, `reasonCodes`, `rationale`, `confidence`, and `abstain`. Decisions additionally record selection source, hashes, adapter/config versions, and validation failures.
