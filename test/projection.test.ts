import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPolicy } from '../src/default-policy.ts';
import { Pipeline } from '../src/pipeline.ts';
import { Store } from '../src/store.ts';
import type { RecoveryEvent } from '../src/types.ts';

// Synthetic events. Times are 12:00 UTC (outside quiet hours) on successive months.
const caseId = 'merchant_demo:sub_cycle';
const event = (
  eventId: string,
  type: RecoveryEvent['type'],
  occurredAt: string,
  failure = true,
): RecoveryEvent => ({
  schemaVersion: '1.0',
  eventId,
  merchantId: 'merchant_demo',
  subscriptionId: 'sub_cycle',
  customerRef: 'customer_cycle',
  type,
  occurredAt,
  receivedAt: occurredAt,
  amountMinor: 129900,
  currency: 'INR',
  consent: true,
  suppressed: false,
  contactAvailable: true,
  identityConsistent: true,
  ...(failure && type !== 'subscription.charged'
    ? { rawFailure: { source: 'customer', reason: 'insufficient_funds' } }
    : {}),
});
const setup = () => {
  const store = new Store();
  const pipeline = new Pipeline(store, defaultPolicy);
  const run = (e: RecoveryEvent) => pipeline.process(e, e.occurredAt);
  return { store, run };
};
const credited = (store: Store) =>
  store
    .view(caseId)
    .outcomes.filter((o) => o.recoveredAmountMinor !== undefined)
    .map((o) => o.eventId);

test('a routine charge with no open failure creates no case and credits nothing', () => {
  const { run } = setup();
  const view = run(event('evt_routine', 'subscription.charged', '2026-01-05T12:00:00.000Z'));
  assert.equal(view.case, undefined);
  assert.equal(view.outcomes.length, 0);
  assert.ok(view.audit.some((a) => a.kind === 'ROUTINE_EVENT_IGNORED'));
  // A redelivery of the same routine event is handled, not an invariant failure.
  const again = run(event('evt_routine', 'subscription.charged', '2026-01-05T12:00:00.000Z'));
  assert.equal(again.case, undefined);
});

test('a failure in the next billing cycle reopens a recovered case as a new episode', () => {
  const { store, run } = setup();
  run(event('evt_jan_fail', 'subscription.pending', '2026-01-05T12:00:00.000Z'));
  run(event('evt_jan_ok', 'subscription.charged', '2026-01-07T12:00:00.000Z'));
  assert.equal(store.getCase(caseId)!.state, 'RECOVERED');

  const view = run(event('evt_feb_fail', 'subscription.pending', '2026-02-05T12:00:00.000Z'));
  assert.equal(view.case!.state, 'OPEN_PENDING');
  assert.equal(view.case!.episode, 2);
  assert.equal(view.case!.contactCount, 1, 'cap restarts for the new episode');
  assert.equal(view.decisions.at(-1)!.selectedAction, 'SEND_GENTLE_REMINDER');
  assert.equal(view.outbox.length, 2);
  assert.ok(view.audit.some((a) => a.kind === 'EPISODE_OPENED'));
});

test('recovered revenue is credited once per episode, never for routine charges', () => {
  const { store, run } = setup();
  run(event('evt_jan_fail', 'subscription.pending', '2026-01-05T12:00:00.000Z'));
  run(event('evt_jan_ok', 'subscription.charged', '2026-01-07T12:00:00.000Z'));
  run(event('evt_feb_ok', 'subscription.charged', '2026-02-07T12:00:00.000Z'));
  run(event('evt_mar_fail', 'subscription.pending', '2026-03-05T12:00:00.000Z'));
  run(event('evt_mar_ok', 'subscription.charged', '2026-03-06T12:00:00.000Z'));
  assert.deepEqual(credited(store), ['evt_jan_ok', 'evt_mar_ok']);
});

test('a stale event delivered late never triggers a new outward action', () => {
  const { store, run } = setup();
  run(event('evt_halt', 'subscription.halted', '2026-01-10T12:00:00.000Z'));
  assert.equal(store.view(caseId).outbox.length, 1, 'halted escalates once');
  const view = run(event('evt_late_pending', 'subscription.pending', '2026-01-05T12:00:00.000Z'));
  assert.equal(view.case!.state, 'OPEN_HALTED');
  assert.equal(view.decisions.at(-1)!.selectedAction, 'WAIT');
  assert.deepEqual(view.decisions.at(-1)!.reasonCodes.slice(0, 1), ['STALE_EVENT_NO_NEW_ACTION']);
  assert.equal(view.outbox.length, 1);
});

test('a late pending older than the recovery does not reopen the case', () => {
  const { store, run } = setup();
  run(event('evt_fail', 'subscription.pending', '2026-01-05T12:00:00.000Z'));
  run(event('evt_ok', 'subscription.charged', '2026-01-07T12:00:00.000Z'));
  const view = run(event('evt_late', 'subscription.pending', '2026-01-06T12:00:00.000Z'));
  assert.equal(view.case!.state, 'RECOVERED');
  assert.equal(view.case!.episode, 1);
  assert.equal(credited(store).length, 1);
});
