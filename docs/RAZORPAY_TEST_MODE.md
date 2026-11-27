# Capturing real Razorpay test-mode webhooks

Goal: replace "Razorpay-shaped" assumptions with real, signed **test-mode** events, redacted
and committed to `fixtures/captured/`, then run them through signature verification, dedup
and the state projection with `npm test` and `npm run captured:report`.

Test mode means no real money and no real customers. **You** do every step that touches your
Razorpay account; nothing in this repo signs in, creates accounts or stores keys.

## What is captured and what is not committed

| Kept in the fixture                                       | Never written to disk                                          |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| event type, timestamps, amounts, currency, status fields  | your webhook secret and API keys                               |
| `error_code` / `error_reason` / `error_source` fields     | emails, phone numbers, names, notes, addresses, card/bank data |
| object ids replaced by stable hashes (`sub_r…`, `pay_r…`) | the account id and the original object ids                     |
| `verifiedAtCapture: true`                                 | the original raw body and its real signature                   |

Each event's signature is checked against your real webhook secret **at capture time**; only
genuine deliveries are written. The redacted body is then re-signed with a fixture-only key
(`FIXTURE_SIGNING_KEY` in `tools/capture/redact.ts`) so tests can verify it without the real
secret. A capture is refused if the redacted body still looks like it contains an email, phone
number, key id or account id.

## Steps you do

### 1. Razorpay account in test mode

1. Sign up / sign in at <https://dashboard.razorpay.com> and switch the dashboard to
   **Test Mode** (toggle at the top). Everything below is in test mode.
2. **Account & Settings → API Keys → Generate Test Key.** Keep the key id (`rzp_test_…`) and
   secret to yourself. You only need them for step 3; the capture itself needs only the
   webhook secret.

### 2. A public HTTPS URL for your laptop

Razorpay must reach `http://127.0.0.1:3001` (the capture server). Use a tunnel, for example
Cloudflare's quick tunnel (no account needed):

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3001
```

It prints an `https://<random>.trycloudflare.com` URL. Keep that window open.

### 3. Webhook in the Razorpay test dashboard

1. **Account & Settings → Webhooks → Add New Webhook.**
2. Webhook URL: the tunnel URL from step 2.
3. Secret: make up a long random string. Put the same value in your local `.env`:

   ```
   RAZORPAY_WEBHOOK_SECRET=<the same random string>
   RAZORPAY_KEY_ID=rzp_test_...   # optional; capture refuses to run if this is not a test key
   ```

   `.env` is git-ignored. Never commit it or paste it into chat.

4. Active events: `subscription.pending`, `subscription.halted`, `subscription.charged`,
   `subscription.activated`, `subscription.cancelled`, `payment.failed` (add others if you
   are curious; they are reported as "extra").

### 4. Start the capture server

```powershell
npm run capture:webhooks
```

It prints one line per captured or rejected delivery.

### 5. A subscription, then a failing charge

Razorpay's docs ("Test Subscriptions", <https://razorpay.com/docs/payments/subscriptions/test>)
describe the flow. At the time of writing:

1. **Subscriptions → Plans → Create Plan** (e.g. monthly, ₹499).
2. **Subscriptions → Create Subscription** on that plan, then open its link and complete the
   authentication payment with a Razorpay **test card** from their docs.
3. On the subscription page, use **Charge this now**. Test mode asks whether the charge should
   **succeed or fail**:
   - choose **failure** → subscription goes `pending` → `subscription.pending` webhook
   - fail it repeatedly (the docs say 4 failures in a row) → `subscription.halted`
   - choose **success** → `subscription.charged` (and `subscription.activated` when it leaves
     `pending`/`halted`)
4. Optionally cancel the subscription → `subscription.cancelled`.

If the dashboard differs from this description, follow Razorpay's current docs and tell me
what you saw; I will update this guide.

### 6. Check what you captured

```powershell
npm run captured:report
npm test
```

The report lists each wanted event type as captured or missing and replays every capture.
Before committing, open a couple of files in `fixtures/captured/` and read them yourself.
Then commit only that folder:

```powershell
git add fixtures/captured
git commit -m "Add redacted Razorpay test-mode webhook captures"
```

### 7. Clean up

Stop the tunnel and the capture server. In the Razorpay test dashboard, delete or disable the
webhook (its URL is a temporary tunnel). Optionally regenerate the test webhook secret.

## What this does not prove

- Test-mode payloads can differ from live mode. Captures prove the parser and safety rules
  handle **real Razorpay test-mode** events, not production traffic.
- Customer messaging, payment links and merchant authentication remain simulated.
- `payment.failed` and `subscription.activated` are currently acknowledged as `UNSUPPORTED`
  (logged, no case change). Once real payloads exist, mapping them is a small, testable change.
