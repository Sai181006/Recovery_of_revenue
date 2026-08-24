# Limitations after Phase 7

The repository proves credential-independent deterministic behavior and a production-style boot boundary, not production readiness, live integration, hosting, or incremental revenue.

Still required before an integrated submission claim:

- Verify the current official Buildathon brief, deadline, judging criteria, and required assets.
- Connect a Razorpay test account through locally supplied secrets and a public HTTPS endpoint.
- Capture and commit only redacted genuine test-mode pending, charged/recovered, and halted payloads.
- Validate mapper fields, retry behavior, reconciliation calls, and a trusted account-specific recovery flow.
- Select and evaluate a live model/provider; keep deterministic fallback and never broaden eligibility.
- Decide whether simulated messaging is acceptable; otherwise approve consent, provider, and deliverability setup.
- Replace demo role headers with real authentication/authorization for any hosted environment.
- Replace local single-process SQLite with a production-capable transactional design only in Phase 8 after repository contracts are reviewed.
- Review privacy, PCI/RBI applicability, retention, tenant isolation, incident handling, and deployment security.

Node's built-in SQLite currently emits an experimental warning. Synthetic fixtures and outcomes cannot establish causal lift. The approved-domain validator does not prove that a URL belongs to the correct customer/case; that requires account-specific trusted-flow evidence.

Phase 7 configuration validates modes and conditional fields but is not a secret manager. `.env` remains local-only, production authentication is absent, demo role headers are trusted input, telemetry is only an injected no-op/test boundary, and graceful shutdown is single-process. The in-memory and SQLite adapters are not yet a shared Phase 8 repository contract suite. No external queue, concurrency control, migration system, reconciliation worker, retry/dead-letter mechanism, backup/restore, retention workflow, rate limiting, or deployment artifact has been added.
