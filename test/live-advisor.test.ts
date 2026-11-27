import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import {
  createClaudeAdvisor,
  precomputeAdvice,
  replayAdvisor,
  type MessagesClient,
} from '../src/adapters/claude-advisor.ts';
import type { AdvisorInput } from '../src/advisor.ts';
import { defaultPolicy } from '../src/default-policy.ts';
import { Pipeline } from '../src/pipeline.ts';
import { Store } from '../src/store.ts';
import type { RecoveryEvent } from '../src/types.ts';
import { evaluateLive } from '../tools/live-evaluation.ts';

// Every test uses a MOCKED provider: no network, no credentials, synthetic events.
type Reply = { text?: string; stop?: Anthropic.Message['stop_reason']; hang?: boolean };
function mockClient(reply: (input: AdvisorInput) => Reply) {
  const calls: Array<{
    params: Anthropic.MessageCreateParamsNonStreaming;
    options?: { timeout?: number };
  }> = [];
  const client: MessagesClient = {
    messages: {
      create(params, options) {
        calls.push({ params, ...(options ? { options } : {}) });
        const first = params.messages[0]!;
        const r = reply(JSON.parse(first.content as string) as AdvisorInput);
        if (r.hang) return new Promise(() => undefined);
        return Promise.resolve({
          stop_reason: r.stop ?? 'end_turn',
          content: [{ type: 'text', text: r.text ?? '' }],
        } as unknown as Anthropic.Message);
      },
    },
  };
  return { client, calls };
}
const answer = (selectedAction: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    schemaVersion: '1.0',
    selectedAction,
    reasonCodes: ['MOCK'],
    rationale: 'Mocked provider answer.',
    confidence: 0.9,
    abstain: false,
    ...extra,
  });
const event: RecoveryEvent = {
  schemaVersion: '1.0',
  eventId: 'evt_live_mock',
  merchantId: 'merchant_demo',
  subscriptionId: 'sub_live_mock',
  customerRef: 'customer_live_mock',
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
};
/** Same two-step flow as the live evaluation: collect inputs, ask the model, replay. */
async function decide(client: MessagesClient, timeoutMs = 200) {
  const live = createClaudeAdvisor({ client, timeoutMs });
  const inputs: AdvisorInput[] = [];
  new Pipeline(
    new Store(),
    defaultPolicy,
    replayAdvisor(live, new Map(), (i) => inputs.push(i)),
  ).process(event);
  const advice = await precomputeAdvice(live, inputs, timeoutMs);
  return new Pipeline(new Store(), defaultPolicy, replayAdvisor(live, advice)).process(event)
    .decisions[0]!;
}

test('valid advice inside the eligible set is used', async () => {
  const { client } = mockClient(() => ({ text: answer('WAIT') }));
  const d = await decide(client);
  assert.equal(d.selectionSource, 'advisor');
  assert.equal(d.selectedAction, 'WAIT');
  assert.equal(d.advisorName, 'claude-advisor');
});

test('the model sees only the bounded advisor input and gets a timeout option', async () => {
  const { client, calls } = mockClient(() => ({ text: answer('WAIT') }));
  await decide(client);
  const sent = JSON.parse(calls[0]!.params.messages[0]!.content as string) as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(sent).sort(), [
    'caseState',
    'eligibleActions',
    'failure',
    'policyVersion',
    'schemaVersion',
    'subscriptionState',
  ]);
  assert.doesNotMatch(JSON.stringify(calls[0]!.params), /customer_live_mock|sub_live_mock|129900/);
  assert.equal(calls[0]!.params.model, 'claude-opus-5-5');
  assert.equal(calls[0]!.options?.timeout, 200);
});

test('an action outside the eligible set is rejected and fixed rules decide', async () => {
  const { client } = mockClient(() => ({ text: answer('ESCALATE_TO_MERCHANT') }));
  const d = await decide(client);
  assert.equal(d.selectionSource, 'deterministic_fallback');
  assert.equal(d.validationError, 'action_not_eligible');
  assert.equal(d.selectedAction, 'SEND_GENTLE_REMINDER');
});

test('extra fields (e.g. a smuggled link) reject the whole answer', async () => {
  const { client } = mockClient(() => ({
    text: answer('SEND_GENTLE_REMINDER', { paymentLink: 'https://example.invalid/pay' }),
  }));
  const d = await decide(client);
  assert.equal(d.selectionSource, 'deterministic_fallback');
  assert.equal(d.validationError, 'unexpected_or_missing_fields');
});

test('non-JSON text falls back to fixed rules', async () => {
  const { client } = mockClient(() => ({ text: 'I would send a reminder.' }));
  const d = await decide(client);
  assert.equal(d.selectionSource, 'deterministic_fallback');
  assert.deepEqual(d.reasonCodes.slice(-1), ['ADVISOR_UNAVAILABLE']);
});

test('a provider that never answers times out and fixed rules decide', async () => {
  const { client } = mockClient(() => ({ hang: true }));
  const started = Date.now();
  const d = await decide(client, 50);
  assert.ok(Date.now() - started < 2000);
  assert.equal(d.selectionSource, 'deterministic_fallback');
  assert.deepEqual(d.reasonCodes.slice(-1), ['ADVISOR_UNAVAILABLE']);
});

test('a refusal or truncated answer is not used as advice', async () => {
  for (const stop of ['refusal', 'max_tokens'] as const) {
    const { client } = mockClient(() => ({ text: answer('WAIT'), stop }));
    const d = await decide(client);
    assert.equal(d.selectionSource, 'deterministic_fallback', stop);
  }
});

test('abstention or low confidence selects WAIT when it is eligible', async () => {
  for (const extra of [{ abstain: true }, { confidence: 0.3 }]) {
    const { client } = mockClient(() => ({ text: answer('SEND_GENTLE_REMINDER', extra) }));
    const d = await decide(client);
    assert.equal(d.selectionSource, 'advisor_abstention');
    assert.equal(d.selectedAction, 'WAIT');
  }
});

test('a hostile advisor cannot break the release gate on the 14 synthetic scenarios', async () => {
  // Always pushes the most intrusive contact, sometimes with a smuggled field.
  let n = 0;
  const { client } = mockClient(() => ({
    text: answer('SURFACE_PAYMENT_UPDATE_LINK', n++ % 2 ? { url: 'https://example.invalid' } : {}),
  }));
  const report = await evaluateLive(createClaudeAdvisor({ client }), undefined, 200);
  assert.equal(report.metrics.live_advisor.criticalViolations, 0);
  assert.equal(report.metrics.live_advisor.cases, 14);
  assert.ok(report.decisionSources.deterministic_fallback! > 0);
});
