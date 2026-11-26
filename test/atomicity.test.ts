import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { pendingPayload } from '../fixtures/razorpay-test-events.ts';
import { defaultPolicy } from '../src/default-policy.ts';
import { Pipeline } from '../src/pipeline.ts';
import { Store } from '../src/store.ts';
import { WebhookProcessor } from '../src/webhook.ts';

// Synthetic fixture payload; the failure is injected to simulate a disk/database error.
const secret = 'local-test-secret-not-a-live-credential';
const context = {
  merchantId: 'merchant_demo',
  consent: true,
  suppressed: false,
  contactAvailable: true,
  trustedUpdateLinkAvailable: false,
};

test('a failure mid-processing rolls back every write and a redelivery succeeds', () => {
  const store = new Store();
  const processor = new WebhookProcessor(
    store,
    new Pipeline(store, defaultPolicy),
    secret,
    context,
  );
  const raw = Buffer.from(JSON.stringify(pendingPayload));
  const headers = {
    'x-razorpay-event-id': 'rzp_evt_atomic',
    'x-razorpay-signature': createHmac('sha256', secret).update(raw).digest('hex'),
  };
  const saveDecision = store.saveDecision.bind(store);
  store.saveDecision = () => {
    throw new Error('simulated disk failure');
  };
  const first = processor.process(raw, headers, '2026-08-23T12:00:00.000Z');
  assert.equal(first.processingStatus, 'FAILED');
  assert.equal(store.counts().inbox, 0, 'inbox row rolled back');
  assert.equal(store.getCase('merchant_demo:sub_test_redacted_001'), undefined);

  store.saveDecision = saveDecision;
  const retry = processor.process(raw, headers, '2026-08-23T12:01:00.000Z');
  assert.equal(retry.processingStatus, 'PROCESSED');
  const view = store.view('merchant_demo:sub_test_redacted_001');
  assert.equal(view.decisions.length, 1);
  assert.equal(view.case?.state, 'OPEN_PENDING');
});

test('nested transactions join the outer one and roll back together', () => {
  const store = new Store();
  assert.throws(() =>
    store.transaction(() => {
      store.transaction(() => store.markOutboxDelivered('none'));
      store.db.exec("INSERT INTO cases VALUES('c1','{}')");
      throw new Error('abort');
    }),
  );
  assert.equal(store.getCase('c1'), undefined);
});
