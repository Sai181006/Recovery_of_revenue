import { defaultPolicy } from './default-policy.ts';
import { Pipeline } from './pipeline.ts';
import { Store } from './store.ts';
import type { Scenario } from './types.ts';
export function runScenario(s: Scenario) {
  const store = new Store();
  const pipeline = new Pipeline(store, defaultPolicy);
  let view: ReturnType<Pipeline['process']> | undefined;
  for (const e of s.events) view = pipeline.process(e, s.now);
  if (!view?.case) throw new Error(`${s.id}: case missing`);
  const latest = view.decisions.at(-1);
  if (!latest) throw new Error(`${s.id}: decision missing`);
  const actual = {
    caseState: view.case.state,
    eligibleActions: latest.eligibleActions,
    selectedAction: latest.selectedAction,
    prohibitedActions: latest.prohibitedActions,
    outboxCount: view.outbox.length,
  };
  const failures: string[] = [];
  if (actual.caseState !== s.expected.caseState) failures.push(`state ${actual.caseState}`);
  if (JSON.stringify(actual.eligibleActions) !== JSON.stringify(s.expected.eligibleActions))
    failures.push(`eligible ${JSON.stringify(actual.eligibleActions)}`);
  if (!s.expected.acceptableSelectedActions.includes(actual.selectedAction))
    failures.push(`selected ${actual.selectedAction}`);
  if (JSON.stringify(actual.prohibitedActions) !== JSON.stringify(s.expected.prohibitedActions))
    failures.push('prohibited mismatch');
  if (actual.outboxCount !== s.expected.outboxCount) failures.push(`outbox ${actual.outboxCount}`);
  return { id: s.id, pass: failures.length === 0, failures, actual, view };
}
