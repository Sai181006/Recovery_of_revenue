import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPolicy } from '../src/default-policy.ts';
import { MerchantExperience, preview, validateRecoveryUrl } from '../src/experience.ts';
import { Pipeline } from '../src/pipeline.ts';
import { Store } from '../src/store.ts';
import type { RecoveryEvent } from '../src/types.ts';
const event = (id = 'evt_experience'): RecoveryEvent => ({
  schemaVersion: '1.0',
  eventId: id,
  merchantId: 'merchant_demo',
  subscriptionId: 'sub_experience',
  customerRef: 'cust_experience',
  type: 'subscription.pending',
  occurredAt: '2026-08-23T12:00:00.000Z',
  receivedAt: '2026-08-23T12:00:00.000Z',
  amountMinor: 129900,
  currency: 'INR',
  consent: true,
  suppressed: false,
  contactAvailable: true,
  identityConsistent: true,
  rawFailure: { source: 'customer', reason: 'insufficient_funds' },
});
const setup = () => {
  const store = new Store();
  new Pipeline(store, defaultPolicy).process(event());
  return { store, service: new MerchantExperience(store) };
};
test('fixed templates contain bounded copy and no fabricated URL', () => {
  const message = preview('SEND_GENTLE_REMINDER');
  assert.equal(message?.templateVersion, 'recovery-en-v1');
  assert.deepEqual(message?.recoveryDestination, { mode: 'simulated' });
  assert.equal(JSON.stringify(message).includes('http'), false);
});
test('trusted URL validator requires HTTPS and approved exact or subdomain host', () => {
  assert.equal(validateRecoveryUrl('https://api.razorpay.com/recovery', ['razorpay.com']), true);
  assert.equal(validateRecoveryUrl('http://razorpay.com/recovery', ['razorpay.com']), false);
  assert.equal(
    validateRecoveryUrl('https://razorpay.com.evil.invalid/recovery', ['razorpay.com']),
    false,
  );
  assert.throws(
    () =>
      preview('SURFACE_PAYMENT_UPDATE_LINK', { mode: 'trusted_url', url: 'https://evil.invalid' }),
    /untrusted/,
  );
});
test('merchant operator can suppress once and future repeats remain idempotent', () => {
  const { store, service } = setup();
  service.suppress('merchant_demo:sub_experience', 'merchant_operator', '2026-08-23T13:00:00.000Z');
  const second = service.suppress(
    'merchant_demo:sub_experience',
    'merchant_operator',
    '2026-08-23T13:00:00.000Z',
  );
  assert.equal(second.case.state, 'SUPPRESSED');
  assert.equal(
    store
      .view('merchant_demo:sub_experience')
      .audit.filter((a: { kind: string }) => a.kind === 'CASE_SUPPRESSED').length,
    1,
  );
});
test('suppression blocks later failure contacts but recovery still closes the case', () => {
  const { store, service } = setup();
  service.suppress('merchant_demo:sub_experience', 'merchant_operator', '2026-08-23T13:00:00.000Z');
  const pipeline = new Pipeline(store, defaultPolicy);
  pipeline.process({
    ...event('evt_after_suppress'),
    occurredAt: '2026-08-24T12:00:00.000Z',
    receivedAt: '2026-08-24T12:00:00.000Z',
  });
  let view = store.view('merchant_demo:sub_experience');
  assert.equal(view.case!.state, 'SUPPRESSED');
  assert.equal(view.decisions.at(-1)!.selectedAction, 'SUPPRESS');
  pipeline.process({
    ...event('evt_recovery_after_suppress'),
    type: 'subscription.charged',
    occurredAt: '2026-08-25T12:00:00.000Z',
    receivedAt: '2026-08-25T12:00:00.000Z',
  });
  view = store.view('merchant_demo:sub_experience');
  assert.equal(view.case!.state, 'RECOVERED');
});
test('only admins may override and action must remain eligible', () => {
  const { service } = setup();
  assert.throws(
    () =>
      service.override(
        'merchant_demo:sub_experience',
        'WAIT',
        'merchant_operator',
        '2026-08-23T13:00:00.000Z',
      ),
    /forbidden/,
  );
  assert.throws(
    () =>
      service.override(
        'merchant_demo:sub_experience',
        'SEND_ACTION_REQUIRED',
        'merchant_admin',
        '2026-08-23T13:00:00.000Z',
      ),
    /not eligible/,
  );
  const view = service.override(
    'merchant_demo:sub_experience',
    'WAIT',
    'merchant_admin',
    '2026-08-23T13:00:00.000Z',
  );
  assert.ok(view.audit.some((a: { kind: string }) => a.kind === 'OVERRIDE_RECORDED'));
});
test('override dispatch and delivery update are idempotent', () => {
  const { service } = setup();
  const first = service.override(
    'merchant_demo:sub_experience',
    'SEND_GENTLE_REMINDER',
    'merchant_admin',
    '2026-08-23T13:00:00.000Z',
  );
  const second = service.override(
    'merchant_demo:sub_experience',
    'SEND_GENTLE_REMINDER',
    'merchant_admin',
    '2026-08-23T13:00:00.000Z',
  );
  assert.equal(second.outbox.length, first.outbox.length);
  const item = second.outbox[0]!;
  service.markDelivered(item.id, 'merchant_operator', '2026-08-23T13:05:00.000Z');
  const delivered = service.markDelivered(item.id, 'merchant_operator', '2026-08-23T13:05:00.000Z');
  assert.equal(delivered.outbox[0]!.status, 'SIMULATED_DELIVERED');
  assert.equal(
    delivered.audit.filter((a: { kind: string }) => a.kind === 'DELIVERY_UPDATED').length,
    1,
  );
});
test('recovered cases reject suppression and override', () => {
  const store = new Store();
  new Pipeline(store, defaultPolicy).process({
    ...event('evt_recovered_experience'),
    type: 'subscription.charged',
  });
  const service = new MerchantExperience(store);
  assert.throws(
    () =>
      service.suppress(
        'merchant_demo:sub_experience',
        'merchant_admin',
        '2026-08-23T13:00:00.000Z',
      ),
    /terminal/,
  );
  assert.throws(
    () =>
      service.override(
        'merchant_demo:sub_experience',
        'SUPPRESS',
        'merchant_admin',
        '2026-08-23T13:00:00.000Z',
      ),
    /terminal/,
  );
});
