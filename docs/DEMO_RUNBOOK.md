# Demo runbook

## Primary fixture demo (about 4 minutes)

1. Run `npm install` and `npm run release:check`.
2. Run `npm run demo:seed`, then `npm start`.
3. Open `/health` and identify fixture readiness plus intentionally unavailable integrations.
4. Open `/cases`; choose insufficient-funds, expired-card, halted, and suppressed examples.
5. Show exact evidence, normalized failure, eligible/prohibited actions, selection source, message preview, outbox, outcome, and audit.
6. Replay the duplicate scenario and show one logical decision/outbox action.
7. Open `/evaluation`; show 42 matched traces and the passing critical release gate.
8. State clearly that all contacts, advisor results, and recovery proxies are simulated.

## Signed-webhook local proof

Set a temporary local `RAZORPAY_WEBHOOK_SECRET`, sign the untouched JSON bytes with HMAC-SHA256, and post to `/webhooks/razorpay` with `X-Razorpay-Signature` and `X-Razorpay-Event-Id`. Show the verified receipt, case, and duplicate behavior. Never record the secret.

## Fallback

If network or external accounts are unavailable, use only the fixture demo. Run `npm run demo:reset && npm run demo:seed` to return to a known state. If a provider is unavailable, decisions retain the fixed-rule fallback. Invalid webhooks are persisted as rejected and never processed.
