import { scenarios as allScenarios } from '../fixtures/synthetic/scenarios.ts';
import {
  precomputeAdvice,
  replayAdvisor,
  type LiveAdvisor,
  type PrecomputedAdvice,
} from '../src/adapters/claude-advisor.ts';
import type { AdvisorInput } from '../src/advisor.ts';
import { defaultPolicy } from '../src/default-policy.ts';
import { summarize, trace } from '../src/evaluation.ts';
import { Pipeline } from '../src/pipeline.ts';
import { Store } from '../src/store.ts';
import type { Scenario } from '../src/types.ts';

/**
 * Evaluates a live advisor on the same synthetic scenarios as `npm run evaluate`,
 * next to the fixed rules. The model is asked once per distinct advisor input the
 * pipeline actually produces (a few passes, because an earlier choice can change a
 * later input), then the answers are replayed through the unchanged pipeline.
 */
export async function evaluateLive(
  live: LiveAdvisor,
  scenarios: Scenario[] = allScenarios,
  timeoutMs = 30_000,
) {
  const advice: PrecomputedAdvice = new Map();
  for (let pass = 0; pass < 4; pass++) {
    const missing: AdvisorInput[] = [];
    const recorder = replayAdvisor(live, advice, (input) => missing.push(input));
    for (const s of scenarios) trace(s, 'live_advisor', recorder);
    if (!missing.length) break;
    await precomputeAdvice(live, missing, timeoutMs, advice);
  }
  const advisor = replayAdvisor(live, advice);
  const fixed = scenarios.map((s) => trace(s, 'fixed_rule', undefined));
  const liveTraces = scenarios.map((s) => trace(s, 'live_advisor', advisor));

  // How each decision was made: accepted advice, abstention, or fixed-rule fallback.
  const sources: Record<string, number> = {};
  const rejections: Record<string, number> = {};
  for (const s of scenarios) {
    const store = new Store(':memory:');
    const pipeline = new Pipeline(store, defaultPolicy, advisor);
    for (const event of s.events) pipeline.process(event, s.now);
    for (const c of store.listCases())
      for (const d of store.view(c.id).decisions) {
        const source = d.selectionSource ?? 'unknown';
        sources[source] = (sources[source] ?? 0) + 1;
        if (d.validationError)
          rejections[d.validationError] = (rejections[d.validationError] ?? 0) + 1;
      }
    store.close();
  }
  const calls = [...advice.values()];
  return {
    advisor: { name: live.name, model: live.version, prompt: live.configVersion },
    dataset: 'synthetic_fixtures_v1',
    modelCalls: calls.length,
    modelErrors: calls.filter((c) => 'error' in c).length,
    decisionSources: sources,
    rejectedOutputs: rejections,
    metrics: { fixed_rule: summarize(fixed), live_advisor: summarize(liveTraces) },
    traces: liveTraces,
  };
}
