import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { pendingPayload } from '../fixtures/razorpay-test-events.ts';
import { createApplication } from '../src/application.ts';
import { createHttpApp, type AccessConfig } from '../src/http-app.ts';
import { seedDemoFixtures } from '../src/seeding.ts';
import { Store } from '../src/store.ts';

// Real HTTP requests against the server on an ephemeral port, seeded with the
// synthetic demo fixtures. Tokens and secrets below are test-only values.
const secret = 'local-test-secret-not-a-live-credential';
const token = 'test-admin-token-not-a-real-secret';
const caseId = encodeURIComponent('merchant_demo:sub_evt_funds');

async function serve(access?: AccessConfig) {
  const application = createApplication({
    repository: new Store(':memory:'),
    clock: { now: () => '2026-08-23T12:00:00.000Z' },
    webhookSecret: secret,
  });
  seedDemoFixtures(application);
  const server = createHttpApp({ application, publicDir: 'public', ...(access ? { access } : {}) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit = {}) => fetch(base + path, init);
  return {
    call,
    close: () => {
      application.close();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
const post = (headers: Record<string, string> = {}, body?: string): RequestInit => ({
  method: 'POST',
  headers,
  ...(body === undefined ? {} : { body }),
});

test('demo access: role header picks permissions and bad input is a 4xx, not a 500', async (t) => {
  const app = await serve();
  t.after(app.close);
  assert.equal((await app.call('/cases')).status, 200);
  assert.equal((await app.call('/health')).status, 200);
  assert.equal((await app.call('/nope')).status, 404);
  assert.equal((await app.call('/cases/%E0%A4%A')).status, 400);
  const operator = { 'x-merchant-role': 'merchant_operator' };
  assert.equal(
    (await app.call(`/cases/${caseId}/override`, post(operator, '{"action":"WAIT"}'))).status,
    403,
  );
  const admin = { 'x-merchant-role': 'merchant_admin' };
  assert.equal((await app.call(`/cases/${caseId}/override`, post(admin, 'null'))).status, 400);
  assert.equal((await app.call(`/cases/${caseId}/override`, post(admin, '{oops'))).status, 400);
  assert.equal((await app.call(`/cases/${caseId}/suppress`, post(operator))).status, 200);
});

test('read-only deployment refuses every control but serves data', async (t) => {
  const app = await serve({ readOnly: true });
  t.after(app.close);
  assert.equal((await app.call('/cases')).status, 200);
  const admin = { 'x-merchant-role': 'merchant_admin' };
  assert.equal((await app.call(`/cases/${caseId}/suppress`, post(admin))).status, 403);
  assert.equal((await app.call('/outbox/any/deliver', post(admin))).status, 403);
});

test('production without a token exposes no case data and no controls', async (t) => {
  const app = await serve({ protectData: true });
  t.after(app.close);
  assert.equal((await app.call('/cases')).status, 401);
  assert.equal((await app.call('/webhook-receipts')).status, 401);
  assert.equal((await app.call(`/cases/${caseId}`)).status, 401);
  const admin = { 'x-merchant-role': 'merchant_admin' };
  assert.equal((await app.call(`/cases/${caseId}/suppress`, post(admin))).status, 403);
  assert.equal((await app.call('/health')).status, 200);
});

test('production with a token requires the exact bearer token', async (t) => {
  const app = await serve({ protectData: true, adminToken: token });
  t.after(app.close);
  const auth = { authorization: `Bearer ${token}` };
  assert.equal((await app.call('/cases', { headers: auth })).status, 200);
  assert.equal(
    (await app.call('/cases', { headers: { authorization: `Bearer ${token}x` } })).status,
    401,
  );
  const role = { 'x-merchant-role': 'merchant_admin' };
  assert.equal((await app.call(`/cases/${caseId}/suppress`, post(role))).status, 401);
  assert.equal(
    (await app.call(`/cases/${caseId}/suppress`, post({ ...role, ...auth }))).status,
    200,
  );
});

test('webhook statuses: 401 unsigned, 202 processed, 200 for verified but unsupported', async (t) => {
  const app = await serve();
  t.after(app.close);
  const send = (payload: unknown, eventId: string, sign = true) => {
    const raw = JSON.stringify(payload);
    const signature = sign
      ? createHmac('sha256', secret).update(raw).digest('hex')
      : '0'.repeat(64);
    return app.call(
      '/webhooks/razorpay',
      post({ 'x-razorpay-event-id': eventId, 'x-razorpay-signature': signature }, raw),
    );
  };
  assert.equal((await send(pendingPayload, 'rzp_evt_http_bad', false)).status, 401);
  assert.equal((await send(pendingPayload, 'rzp_evt_http_ok')).status, 202);
  const unsupported = await send({ ...pendingPayload, event: 'payment.failed' }, 'rzp_evt_http_u');
  assert.equal(unsupported.status, 200);
  assert.equal(
    ((await unsupported.json()) as { processingStatus: string }).processingStatus,
    'UNSUPPORTED',
  );
});
