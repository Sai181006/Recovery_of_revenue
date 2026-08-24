# Architecture and safety boundaries

## Phase 7 runtime shape

```text
process entrypoint (production or demo)
  -> validated RuntimeConfig
  -> SQLite repository adapter + injected clock/telemetry
  -> createApplication(ports)
       -> deterministic pipeline and policy
       -> bounded advisor boundary
       -> delivery/execution boundary
       -> merchant application service
       -> webhook processor
  -> createHttpApp(application)       [construct only]
  -> listen                           [entrypoint only]
  -> graceful close: HTTP, then SQLite

demo/development entrypoint -> reset safe demo DB -> seedDemoFixtures -> listen
production entrypoint       -> empty/existing DB, never seed             -> listen
```

`src/ports.ts` defines a repository, clock, advisor, delivery/execution, and telemetry boundary. These exist because application behavior depends on them; presentation-only helpers remain concrete. `Store` is the local SQLite adapter. `MemoryStore` supports application tests without a port or filesystem database. The optional advisor remains provider neutral, and the delivery adapter remains simulated.

`createApplication` has no filesystem or network side effects. `createHttpApp` builds a Node HTTP server but does not bind it. Importing `application.ts`, `http-app.ts`, `api.ts`, or `server.ts` does not seed, create a directory/database, or listen. `createRuntime` explicitly owns resource creation, while process entrypoints own mode selection and signal handling.

## Deterministic processing boundary

```text
raw signed webhook -> verified/redacted receipt -> event inbox -> monotonic projection
                                                              -> deterministic policy gate
                                                              -> eligible action allowlist
                                                              -> bounded advisor or fixed fallback
                                                              -> deterministic execution gate
                                                              -> simulated outbox + audit + outcome
                                                              -> merchant workspace + JSON API + evaluation
```

Razorpay remains the payment system of record. Deterministic code owns signature verification, persistence, deduplication, ordering, state transitions, normalization, policy, eligibility, cooldowns, caps, quiet hours, suppression, dispatch authorization, idempotency, and audit. The advisor can rank only an existing eligible set and has no credentials, raw customer identity, payment data, arbitrary tools, or dispatch access.

## Configuration and errors

Runtime modes are exactly `demo`, `development`, and `production`. Host, port, SQLite data path, and public directory are environment controlled with loopback/local safe defaults. Webhook handling is disabled unless `WEBHOOK_ENABLED=true`; that condition requires a webhook secret. Validation fails before resource creation/listening and reports field-level issues without values.

Application failures use stable `AppError` codes. One HTTP mapper owns status and safe response text, so internal exception messages are never serialized. Existing successful JSON route shapes and the UI are unchanged; error bodies intentionally change to `{ error, code, message }` with machine-readable codes.

SQLite remains local and single-process; Phase 7 does not add PostgreSQL, queues, workers, authentication, real providers, or deployment. Phase 8 may evolve persistence behind the repository contract, but no Phase 8 implementation exists here.
