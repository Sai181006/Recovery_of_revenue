# Revenue Recovery — deterministic local vertical slice

Phase 0–4 implementation for failed recurring Razorpay subscriptions. It includes deterministic recovery mechanics, signed test-mode webhook ingress, a provider-neutral constrained-advisor gate, and a simulated customer/merchant experience. There is no live model provider, messaging provider, credential handling, real payment link, or external side effect.

## Requirements and setup

- Node.js 24 or newer (the project uses built-in SQLite and erasable TypeScript execution)
- `npm install`

Run every check with `npm run verify`. Run the complete fixture batch with `npm run scenarios`. Start the inspection API with `npm start`, then open `http://localhost:3000/cases` or `/cases/{merchantId:subscriptionId}`. The API seeds its local `data/recovery.sqlite` from fixtures and is only a case viewer.

## Razorpay test-mode webhook

Set `RAZORPAY_WEBHOOK_SECRET` locally, start the server, and configure the test-mode webhook endpoint as `POST /webhooks/razorpay`. The handler verifies `X-Razorpay-Signature` against the untouched request bytes and uses `X-Razorpay-Event-Id` for deduplication. Every receipt is stored before mapping or business processing and can be inspected at `GET /webhook-receipts`.

The default server context has no customer consent or approved contact route, so customer contact fails closed. Real merchant consent/contact context and Razorpay reconciliation credentials have deliberately not been added. Never commit `.env` or a webhook secret.

## Constrained advisor boundary

`src/advisor.ts` defines the Phase 3 model contract. An injected adapter receives only lifecycle state, normalized failure labels, policy version, and the deterministic eligible-action set. Strict validation rejects missing/extra fields, actions outside that set, oversized rationale, malformed confidence, and unsafe additions. Unavailable or invalid adapters fall back to fixed rules; abstention or confidence below `0.6` selects `WAIT` when eligible. Input/output hashes and adapter/config versions are stored with the decision.

No live model adapter is configured. The automated suite uses deterministic, malformed, unavailable, low-confidence, and adversarial test adapters to prove the execution boundary without credentials or network access.

## Merchant and customer experience

`GET /cases` returns the merchant queue and `GET /cases/{id}` returns decisions, audit, simulated outbox, and outcomes. Merchant controls require `X-Merchant-Role`: operators/admins may call `POST /cases/{id}/suppress`; only admins may call `POST /cases/{id}/override` with an eligible `action`; operators/admins may call `POST /outbox/{id}/deliver` to simulate delivery.

Customer previews use fixed template version `recovery-en-v1`. Recovery destinations remain simulated. Future real URLs must be HTTPS and match an explicitly approved domain; tests cover deceptive subdomains and insecure URLs. Suppression is durable across later failure events, while a confirmed recovery still closes the case.

Individual checks are `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm test`. Because this zero-dependency sandbox cannot fetch npm packages, `typecheck` performs Node's TypeScript parse/type-stripping validation; install a full static TypeScript checker before Phase 2.

## Safety boundary

Deterministic code owns ingestion, deduplication, monotonic projection, normalization, eligibility, cooldowns, caps, quiet hours, suppression, selection, simulated dispatch, and auditing. Raw failure fields are retained beneath the normalized failure. Unknown, contradictory, invalid, or identity-inconsistent inputs fail closed. Outbox rows are simulated and protected by unique dispatch keys.

Fixtures contain synthetic references only. Never add PAN, CVV, PIN, credentials, secrets, real contact details, or live payment URLs.
