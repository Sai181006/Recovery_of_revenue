# Revenue Recovery — Phase 7 application boundaries

Phase 0–7 credential-independent implementation for failed recurring Razorpay subscriptions. Phase 7 separates the deterministic application core, HTTP construction, SQLite, demo fixtures, configuration, and process lifecycle through explicit ports/adapters. The project still has no live Razorpay calls, live model, real messaging, production authentication, trusted real payment link, deployment, or production hosting.

## Requirements and setup

- Node.js 24 or newer
- `npm install`

For the deterministic merchant experience, run `npm run dev`, then open `http://localhost:3000`. It resets and seeds the fixture database before listening. `npm run demo` first executes the complete release gate and then starts the same seeded experience in explicit `demo` mode. The dashboard retains overview metrics, a searchable queue, case evidence and decisions, bounded controls, previews, outcomes, audit, and matched evaluation.

`npm start` is intentionally different: it launches explicit `production` mode and never seeds synthetic cases. On a clean data path, `/cases` is empty. “Production-style” describes the boot boundary only; it does not claim production infrastructure or readiness.

Copy `.env.example` to `.env` only to change `HOST`, `PORT`, `DATA_PATH`, or `PUBLIC_DIR`. `APP_MODE` is validated as `demo`, `development`, or `production`; npm commands pass their intended mode explicitly. `WEBHOOK_ENABLED` defaults to `false` and conditionally requires `RAZORPAY_WEBHOOK_SECRET` only when enabled. Invalid configuration fails before listening and diagnostics name fields without printing values.

Use `npm run demo:reset` to remove only the local `data/recovery.sqlite*` files and `npm run demo:seed` to rebuild the deterministic demo without opening a port. Run `npm run release:check` for Prettier, ESLint plus safety lint, full semantic TypeScript checking, tests, scenarios, evaluation, artifact/secret/generated-data audits, and claim checks. JSON routes remain at `/cases`, `/evaluation`, `/health`, and `/webhook-receipts`.

## Phase 7 module boundaries

- `src/application.ts` constructs application services from injected repository, clock, advisor, delivery/execution, and telemetry ports.
- `src/ports.ts` defines the small operational boundaries; `src/store.ts` and `src/memory-store.ts` are SQLite and in-memory adapters.
- `src/http-app.ts` constructs HTTP behavior but never listens, seeds, or creates storage.
- `src/config.ts`, `src/runtime.ts`, and `src/server.ts` validate configuration, create resources, listen, and close HTTP/SQLite gracefully.
- `src/seeding.ts` and demo tools exclusively own synthetic fixture seeding.

Importing application, HTTP, or server modules has no startup or seed side effects. Application tests use `MemoryStore` with an injected clock and no socket. Application/HTTP failures expose stable codes such as `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, and `INTERNAL_ERROR`; internal exception details are not returned.

## Razorpay-shaped test webhook

Set `WEBHOOK_ENABLED=true` and `RAZORPAY_WEBHOOK_SECRET` locally, start the server, and configure the test-mode-shaped endpoint as `POST /webhooks/razorpay`. The handler verifies `X-Razorpay-Signature` against untouched bytes and uses `X-Razorpay-Event-Id` for deduplication. Every receipt is stored before mapping or business processing and is inspectable at `GET /webhook-receipts`.

The default server context has no customer consent or approved contact route, so customer contact fails closed. This repository contains no Razorpay credentials, API calls, or genuine captured account lifecycle. Never commit `.env` or a webhook secret.

## Constrained advisor and experience

`src/advisor.ts` defines the provider-neutral bounded contract. An injected adapter receives only lifecycle state, normalized failure labels, policy version, and the deterministic eligible set. Strict validation rejects missing/extra fields, actions outside that set, oversized rationale, malformed confidence, and unsafe additions. Unavailable or invalid adapters fall back to fixed rules; low confidence or abstention uses `WAIT` when eligible.

No live model adapter is configured. Delivery and recovery destinations remain simulated. `GET /cases/{id}` exposes decisions, audit, outbox, and outcomes. Demo controls still use `X-Merchant-Role`; these headers are not production authentication.

## Evaluation and checks

`npm run evaluate` writes `reports/evaluation-v1.json` and compares no-added-contact, fixed-rule, and bounded-advisor simulation across the same 14 fixtures. Synthetic recovery is a declared fixture label, not observed revenue, incremental lift, or causal evidence.

Individual gates are `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run scenarios`, and `npm run evaluate`. Phase 7 installs Prettier, ESLint, TypeScript, and Node typings; `npm run typecheck` performs strict semantic analysis with `tsc --noEmit`.

## Safety boundary

Deterministic code still owns verification, ingestion, deduplication, monotonic projection, normalization, eligibility, cooldowns, caps, quiet hours, suppression, dispatch authorization, idempotency, and audit. Unknown, contradictory, invalid, or identity-inconsistent inputs fail closed. Fixtures contain synthetic references only. Never add PAN, CVV, PIN, credentials, secrets, real contact details, or live payment URLs.

See `docs/ARCHITECTURE.md`, `docs/DEMO_RUNBOOK.md`, `docs/LIMITATIONS.md`, and `docs/SUBMISSION_CHECKLIST.md`.
