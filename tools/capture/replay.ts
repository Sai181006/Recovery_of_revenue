import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultPolicy } from '../../src/default-policy.ts';
import { Pipeline } from '../../src/pipeline.ts';
import { Store } from '../../src/store.ts';
import { WebhookProcessor } from '../../src/webhook.ts';
import { FIXTURE_SIGNING_KEY, type CapturedEvent } from './redact.ts';

/** The subscription lifecycle events a recovery flow cares about. */
export const WANTED_EVENTS = [
  'subscription.pending',
  'subscription.halted',
  'subscription.charged',
  'subscription.activated',
  'subscription.cancelled',
  'payment.failed',
];

export const CAPTURED_DIR = join('fixtures', 'captured');

export function loadCaptured(dir = CAPTURED_DIR): Array<CapturedEvent & { file: string }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      ...(JSON.parse(readFileSync(join(dir, file), 'utf8')) as CapturedEvent),
    }));
}

/** Replays captures in order through the real processor (fail-closed default context). */
export function replayCaptured(events: Array<CapturedEvent & { file: string }>) {
  const store = new Store(':memory:');
  const processor = new WebhookProcessor(
    store,
    new Pipeline(store, defaultPolicy),
    FIXTURE_SIGNING_KEY,
    {
      merchantId: 'merchant_test',
      consent: false,
      suppressed: false,
      contactAvailable: false,
      trustedUpdateLinkAvailable: false,
    },
  );
  const results = events.map((e) => {
    const result = processor.process(
      Buffer.from(e.body),
      { 'x-razorpay-event-id': e.eventId, 'x-razorpay-signature': e.fixtureSignature },
      e.capturedAt,
    );
    const caseState = result.caseId ? store.getCase(result.caseId)?.state : undefined;
    return { file: e.file, event: e.event, status: result.processingStatus, caseState, result };
  });
  store.close();
  return results;
}
