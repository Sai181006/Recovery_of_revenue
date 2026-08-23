# Limitations and Phase 6 integration gate

The repository currently proves local deterministic behavior, not production readiness or incremental revenue.

Still required before an integrated submission claim:

- Verify the current official Buildathon brief, deadline, judging criteria, and required assets.
- Connect a Razorpay test account through locally supplied secrets and a public HTTPS endpoint.
- Capture and commit only redacted genuine test-mode pending, charged/recovered, and halted payloads.
- Validate mapper fields, retry behavior, reconciliation calls, and a trusted account-specific recovery flow.
- Select and evaluate a live model/provider; keep deterministic fallback and never broaden eligibility.
- Decide whether simulated messaging is acceptable; otherwise approve consent, provider, and deliverability setup.
- Replace demo role headers with real authentication/authorization for any hosted environment.
- Add full semantic TypeScript analysis when the package registry/toolchain is available.
- Review privacy, PCI/RBI applicability, retention, tenant isolation, incident handling, and deployment security.

Node's built-in SQLite currently emits an experimental warning. Synthetic fixtures and outcomes cannot establish causal lift. The approved-domain validator does not prove that a URL belongs to the correct customer/case; that requires account-specific trusted-flow evidence.
