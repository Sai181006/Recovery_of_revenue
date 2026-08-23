# Revenue Recovery — deterministic local vertical slice

Phase 0 and Phase 1 implementation for failed recurring Razorpay subscriptions. It is entirely local and synthetic: there is no Razorpay SDK, LLM, messaging provider, credential handling, real payment link, or external side effect.

## Requirements and setup

- Node.js 24 or newer (the project uses built-in SQLite and erasable TypeScript execution)
- `npm install`

Run every check with `npm run verify`. Run the complete fixture batch with `npm run scenarios`. Start the inspection API with `npm start`, then open `http://localhost:3000/cases` or `/cases/{merchantId:subscriptionId}`. The API seeds its local `data/recovery.sqlite` from fixtures and is only a case viewer.

Individual checks are `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm test`. Because this zero-dependency sandbox cannot fetch npm packages, `typecheck` performs Node's TypeScript parse/type-stripping validation; install a full static TypeScript checker before Phase 2.

## Safety boundary

Deterministic code owns ingestion, deduplication, monotonic projection, normalization, eligibility, cooldowns, caps, quiet hours, suppression, selection, simulated dispatch, and auditing. Raw failure fields are retained beneath the normalized failure. Unknown, contradictory, invalid, or identity-inconsistent inputs fail closed. Outbox rows are simulated and protected by unique dispatch keys.

Fixtures contain synthetic references only. Never add PAN, CVV, PIN, credentials, secrets, real contact details, or live payment URLs.

