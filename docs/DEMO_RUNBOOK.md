# Demo runbook

## Primary fixture demo (about 4 minutes)

1. Run `npm install`, then `npm run demo`. The command runs every release gate, resets/seeds fixtures, and starts explicit demo mode.
2. Open `http://localhost:3000` and identify the credential-independent demo badge and active safety controls.
3. Use **Recovery cases** to choose insufficient-funds, expired-card, halted, and ambiguous examples.
4. Open a case and show exact evidence, normalized failure, eligible/prohibited actions, selection source, message preview, outbox, outcome, and audit.
5. Demonstrate the simulated delivery or suppress control and show its appended audit event.
6. Show duplicate-delivery's single logical decision/outbox action and the out-of-order recovered case.
7. Open **Evaluation**; show 42 matched traces and the passing critical release gate.
8. State clearly that all contacts, advisor results, and recovery proxies are simulated.

## Signed-webhook local proof

Set temporary local `WEBHOOK_ENABLED=true` and `RAZORPAY_WEBHOOK_SECRET`, sign the untouched JSON bytes with HMAC-SHA256, and post to `/webhooks/razorpay` with `X-Razorpay-Signature` and `X-Razorpay-Event-Id`. Show the verified receipt, case, and duplicate behavior. Never record the secret. This is Razorpay-shaped local proof, not evidence of a connected account.

## Production-style boot proof

1. Set `DATA_PATH` to a new local file and run `npm start`.
2. Request `/cases` and show the empty array: production mode does not create synthetic cases.
3. Stop with Ctrl+C and show the graceful HTTP/SQLite close message.
4. Run `npm run dev` and show the deterministic 14-case merchant experience.

Do not call either path “production hosting” or a live integration.

## Fallback

If network or external accounts are unavailable, use only the fixture demo. It has no remote asset dependency. `npm run dev` always resets to a known seeded state. If a provider is unavailable, decisions retain the fixed-rule fallback. Invalid webhooks are persisted as rejected and never processed.
