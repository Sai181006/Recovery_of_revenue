# Limitations

This is a portfolio project. It demonstrates safe webhook processing and decision logic for
failed subscription payments. It is not deployed in production, has no users, and has
processed no real money.

## What is real

- **Code paths:** HMAC-SHA256 signature verification over raw bytes, receipt storage,
  deduplication by `X-Razorpay-Event-Id`, atomic SQLite processing, the monotonic state
  projection with failure episodes, the deterministic policy, and the HTTP API all run for real
  (`npm test` makes real HTTP requests against the server).
- **Razorpay test-mode events:** tooling to capture real, signed test-mode webhooks
  (`npm run capture:webhooks`), redact them, and replay them through verification, dedup and
  projection (`npm run captured:report`, `npm test`). **Captured so far: none.** The owner has
  not run a capture yet, so `fixtures/captured/` is empty and those two tests are skipped.
  Re-run `npm run captured:report` to see the current list.

## What is synthetic

- The 14 scenarios, the Razorpay-shaped payloads in `fixtures/synthetic/`, the tests that use
  them, the evaluation report and the demo dashboard data were all written by hand for this
  project.
- "Synthetic recoveries" in the evaluation are a declared fixture label, not observed revenue,
  incremental lift or causal evidence.

## What is simulated or missing

- **Customer messaging:** messages go to a simulated outbox; nothing is sent.
- **Payment links / recovery flow:** simulated. The URL allowlist check does not prove a link
  belongs to the right customer.
- **Authentication:** none. Dashboard roles come from an `X-Merchant-Role` header. The only
  protections are `READ_ONLY=true` and a single shared `ADMIN_TOKEN` (required in production
  mode). The dashboard does not send the token, so in production mode it cannot load data.
- **Customer consent:** not modelled per customer. Live webhooks use one merchant-level
  setting that defaults to "no consent", so customer contact is never eligible unless the
  operator sets `WEBHOOK_ASSUME_CONSENT=true` (intended for test mode only).
- **Live model:** `src/adapters/claude-advisor.ts` calls the Claude API behind the advisor
  port, with the same strict validation, deterministic eligible set and fixed-rule fallback.
  It is used only by `npm run evaluate:live`; live webhook decisions still use fixed rules
  (the port is synchronous). Its tests use a mocked provider. **The live evaluation has not
  been run** (it needs the owner's API key and is billed), so there is no evidence yet that
  the model is better, or worse, than the fixed rules.
- **Event coverage:** `subscription.pending/halted/charged/cancelled/paused/resumed` are mapped.
  `payment.failed` and `subscription.activated` are acknowledged and logged as unsupported.
  Whether real `subscription.pending` payloads carry the failure reason is unverified until a
  capture exists.
- **Scheduling:** a decision to wait (quiet hours, cooldown) is never revisited later; there is
  no scheduler or retry worker.
- **Operations:** single process, local SQLite (Node's built-in SQLite still prints an
  experimental warning), no migrations, backups, retention policy, rate limiting or
  multi-tenant isolation. `.env` is not a secret manager. The hosted demo (if deployed) is
  read-only synthetic data on a free tier that sleeps when idle.
- **Compliance:** no privacy, PCI or RBI review has been done.
