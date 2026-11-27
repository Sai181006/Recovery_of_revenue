# Deploying the public demo (Render free tier)

The hosted demo runs the **seeded `demo` mode on synthetic fixture data, read-only**.
It holds no Razorpay keys, no webhook secret and no real customer data. It is not a
production deployment.

What visitors can do: browse the overview, the case queue, case detail (decision,
eligible/prohibited actions, audit timeline, message preview) and the evaluation page.
What they cannot do: suppress, override or mark delivery — `READ_ONLY=true` makes every
control return 403, and the dashboard hides the buttons.

Authentication note: there is no user login. Merchant roles in the dashboard come from
an `X-Merchant-Role` header, which is not authentication; that is why the public demo is
read-only rather than "protected".

## Files

- `render.yaml` — Render Blueprint: one free Docker web service, `APP_MODE=demo`,
  `READ_ONLY=true`, `WEBHOOK_ENABLED=false`, health check on `/health`.
- `Dockerfile` — the same image CI builds and smoke-tests.

## Steps you do in the Render dashboard

These need your own GitHub and Render logins.

1. Merge the PRs up to and including this one into `main` (or pick this branch in step 4).
2. Sign in at <https://dashboard.render.com> with GitHub (free plan; Render may ask for
   account verification).
3. Click **New → Blueprint**, then connect the `Sai181006/Recovery_of_revenue` repository
   (grant Render access to that one repo only).
4. Render reads `render.yaml` and shows one service, `revenue-recovery-demo`, on the Free
   plan. Choose the branch (`main`), then click **Apply** / **Deploy Blueprint**.
5. Wait for the build (the first one takes a few minutes). The service is live when its
   status is **Live** and the health check passes.
6. Open the `https://<service-name>.onrender.com` URL. Check:
   - `https://<url>/health` shows `"mode": "demo"` and `"readOnly": true`
   - the dashboard lists cases, and a case detail shows the read-only note instead of buttons
7. Send me the URL. I will put it at the top of the README with the synthetic-data label.
   Do not paste any keys or tokens; the demo needs none.

## Free-tier behaviour to expect

- Free web services sleep after a period without traffic, and the next visit waits while
  the service wakes up (check Render's current free-tier docs for exact limits). Mention
  this next to the link so a recruiter is not surprised by a slow first load.
- There is no persistent disk on the free plan. That is fine here: the demo reseeds the same
  synthetic data on every start.

## Do not

- Do not set `RAZORPAY_WEBHOOK_SECRET`, `ADMIN_TOKEN` or any key on the public demo.
- Do not switch the public service to `APP_MODE=production` or `READ_ONLY=false`.
