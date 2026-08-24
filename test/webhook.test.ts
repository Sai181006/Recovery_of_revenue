import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { defaultPolicy } from '../src/default-policy.ts';
import { Pipeline } from '../src/pipeline.ts';
import { Store } from '../src/store.ts';
import { WebhookProcessor, redact } from '../src/webhook.ts';
import { chargedPayload, pendingPayload } from '../fixtures/razorpay-test-events.ts';
const secret = 'local-test-secret-not-a-live-credential';
const signed = (payload: unknown) => {
  const raw = Buffer.from(JSON.stringify(payload));
  return { raw, signature: createHmac('sha256', secret).update(raw).digest('hex') };
};
const setup = () => {
  const store = new Store();
  const pipeline = new Pipeline(store, defaultPolicy);
  return {
    store,
    processor: new WebhookProcessor(store, pipeline, secret, {
      merchantId: 'merchant_demo',
      consent: true,
      suppressed: false,
      contactAvailable: true,
      trustedUpdateLinkAvailable: false,
    }),
  };
};
test('valid signed pending event is persisted then processed', () => {
  const { store, processor } = setup();
  const x = signed(pendingPayload);
  const result = processor.process(
    x.raw,
    { 'x-razorpay-event-id': 'rzp_evt_pending', 'x-razorpay-signature': x.signature },
    '2026-08-23T12:00:00.000Z',
  );
  assert.equal(result.processingStatus, 'PROCESSED');
  assert.equal(store.webhookReceipts()[0]!.verification, 'VERIFIED');
  assert.equal(store.view('merchant_demo:sub_test_redacted_001').case!.state, 'OPEN_PENDING');
});
test('invalid signature is persisted and never enters business inbox', () => {
  const { store, processor } = setup();
  const x = signed(pendingPayload);
  const result = processor.process(x.raw, {
    'x-razorpay-event-id': 'rzp_evt_bad',
    'x-razorpay-signature': '0'.repeat(64),
  });
  assert.equal(result.processingStatus, 'REJECTED');
  assert.equal(store.counts().inbox, 0);
  assert.equal(store.webhookReceipts()[0]!.verification, 'INVALID');
});
test('duplicate signed delivery creates one decision and at most one outbox item', () => {
  const { store, processor } = setup();
  const x = signed(pendingPayload);
  const headers = {
    'x-razorpay-event-id': 'rzp_evt_duplicate',
    'x-razorpay-signature': x.signature,
  };
  processor.process(x.raw, headers, '2026-08-23T12:00:00.000Z');
  const second = processor.process(x.raw, headers, '2026-08-23T12:01:00.000Z');
  const view = store.view('merchant_demo:sub_test_redacted_001');
  assert.equal(second.processingStatus, 'DUPLICATE');
  assert.equal(view.decisions.length, 1);
  assert.equal(view.outbox.length, 1);
  assert.equal(store.webhookReceipts().length, 2);
});
test('out-of-order pending cannot regress a confirmed charged event', () => {
  const { store, processor } = setup();
  const charged = signed(chargedPayload);
  processor.process(
    charged.raw,
    { 'x-razorpay-event-id': 'rzp_evt_charged', 'x-razorpay-signature': charged.signature },
    '2026-08-23T13:00:00.000Z',
  );
  const pending = signed(pendingPayload);
  processor.process(
    pending.raw,
    { 'x-razorpay-event-id': 'rzp_evt_stale', 'x-razorpay-signature': pending.signature },
    '2026-08-23T14:00:00.000Z',
  );
  assert.equal(store.view('merchant_demo:sub_test_redacted_001').case!.state, 'RECOVERED');
});
test('missing event id and unsupported event require safe handling', () => {
  const { store, processor } = setup();
  const x = signed(pendingPayload);
  assert.equal(
    processor.process(x.raw, { 'x-razorpay-signature': x.signature }).processingStatus,
    'RECONCILIATION_REQUIRED',
  );
  const unsupported = signed({ ...pendingPayload, event: 'payment.failed' });
  assert.equal(
    processor.process(unsupported.raw, {
      'x-razorpay-event-id': 'rzp_evt_unsupported',
      'x-razorpay-signature': unsupported.signature,
    }).processingStatus,
    'UNSUPPORTED',
  );
  assert.equal(store.counts().inbox, 0);
});
test('redaction removes credential and contact-shaped fields recursively', () => {
  const value = redact({
    email: 'a@example.invalid',
    nested: { card: { number: '4111111111111111' }, token: 'secret' },
    safe: 'kept',
  });
  assert.deepEqual(value, {
    email: '[REDACTED]',
    nested: { card: '[REDACTED]', token: '[REDACTED]' },
    safe: 'kept',
  });
});
