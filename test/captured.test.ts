import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pendingPayload } from '../fixtures/synthetic/razorpay-test-events.ts';
import { verifySignature } from '../src/webhook.ts';
import {
  FIXTURE_SIGNING_KEY,
  hashId,
  leaks,
  redactCapture,
  toFixture,
} from '../tools/capture/redact.ts';
import { loadCaptured, replayCaptured } from '../tools/capture/replay.ts';

// Part 1: the capture/redaction pipeline, exercised with SYNTHETIC input.
test('redaction drops contact, instrument and account data and hashes object ids', () => {
  const raw = {
    account_id: 'acc_Synthetic123',
    event: 'subscription.pending',
    payload: {
      subscription: { entity: { id: 'sub_Synthetic123456', notes: { anything: 'free text' } } },
      payment: {
        entity: {
          id: 'pay_Synthetic123456',
          email: 'someone@example.com',
          contact: '+919999999999',
          card: { last4: '1111' },
          description: 'Paid by someone@example.com via rzp_test_SyntheticKey on +91 99999 99999',
          error_reason: 'insufficient_funds',
        },
      },
    },
  };
  const out = JSON.stringify(redactCapture(raw));
  assert.deepEqual(leaks(out), []);
  for (const original of ['acc_', 'Synthetic123456', 'example.com', '1111', 'free text'])
    assert.doesNotMatch(out, new RegExp(original));
  assert.match(out, /insufficient_funds/, 'failure reasons are kept');
  assert.match(out, new RegExp(hashId('sub_Synthetic123456')), 'ids stay correlatable');
  assert.equal(hashId('sub_Synthetic123456'), hashId('sub_Synthetic123456'));
});

test('a fixture is re-signed with the fixture key, never the real secret', () => {
  const fixture = toFixture(pendingPayload, 'evt_SyntheticEvent1', '2026-08-23T12:00:00.000Z');
  const body = Buffer.from(fixture.body);
  assert.ok(verifySignature(body, fixture.fixtureSignature, FIXTURE_SIGNING_KEY));
  assert.ok(!verifySignature(body, fixture.fixtureSignature, 'some-real-webhook-secret'));
  assert.equal(fixture.verifiedAtCapture, true);
});

test('replay runs a fixture through signature check, dedup and projection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'captured-'));
  try {
    const fixture = toFixture(pendingPayload, 'evt_SyntheticEvent2', '2026-08-23T12:00:00.000Z');
    writeFileSync(join(dir, '001-subscription.pending.json'), JSON.stringify(fixture));
    const events = loadCaptured(dir);
    const [first, again] = replayCaptured([...events, ...events]);
    assert.equal(first!.status, 'PROCESSED');
    assert.equal(first!.caseState, 'OPEN_PENDING');
    assert.equal(again!.status, 'DUPLICATE');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Part 2: REAL Razorpay test-mode captures in fixtures/captured (skipped until captured).
const captured = loadCaptured();

test('captured test-mode events contain no contact data, keys or account ids', (t) => {
  if (!captured.length) return t.skip('no captured events yet; see docs/RAZORPAY_TEST_MODE.md');
  for (const e of captured) {
    assert.equal(e.source, 'razorpay-test-mode', e.file);
    assert.deepEqual(leaks(e.body), [], e.file);
    assert.ok(
      verifySignature(Buffer.from(e.body), e.fixtureSignature, FIXTURE_SIGNING_KEY),
      e.file,
    );
  }
});

test('captured test-mode events replay without failures and dedupe on redelivery', (t) => {
  if (!captured.length) return t.skip('no captured events yet; see docs/RAZORPAY_TEST_MODE.md');
  const results = replayCaptured([...captured, ...captured]);
  const first = results.slice(0, captured.length);
  const second = results.slice(captured.length);
  for (const r of first)
    assert.ok(
      ['PROCESSED', 'UNSUPPORTED', 'RECONCILIATION_REQUIRED'].includes(r.status),
      `${r.file}: ${r.status} ${r.result.error ?? ''}`,
    );
  second.forEach((r, i) => {
    const expected = first[i]!.status === 'PROCESSED' ? 'DUPLICATE' : first[i]!.status;
    assert.equal(r.status, expected, `${r.file} redelivery`);
  });
});

test('leak check flags phone-like strings but not numeric timestamps or amounts', () => {
  assert.deepEqual(leaks(JSON.stringify({ created_at: 1787486400, amount: 4990000000 })), []);
  assert.deepEqual(leaks(JSON.stringify({ note: 'call +91 98765 43210' })), ['phone']);
  assert.deepEqual(leaks(JSON.stringify({ id: 'pay_1234567890123' })), []);
});
