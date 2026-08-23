# Architecture and safety boundaries

```text
raw signed webhook -> verified/redacted receipt -> event inbox -> monotonic projection
                                                              -> deterministic policy gate
                                                              -> eligible action allowlist
                                                              -> bounded advisor or fixed fallback
                                                              -> deterministic execution gate
                                                              -> simulated outbox + audit + outcome
                                                              -> merchant API + evaluation report
```

Razorpay remains the payment system of record. Deterministic code owns signature verification, persistence, deduplication, ordering, state transitions, normalization, policy, eligibility, cooldowns, caps, quiet hours, suppression, dispatch, and audit. The optional advisor can rank only an existing eligible set and has no credentials, raw customer identity, payment data, arbitrary tools, or dispatch access.

SQLite is the local durable store. Webhook receipts and the event inbox are append-only; unique event, decision, and dispatch identities enforce idempotency. Customer delivery, update destinations, advisor calls, and outcomes remain explicitly simulated unless the readiness endpoint reports otherwise.
