import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios } from '../fixtures/scenarios.ts';
import { runScenario } from '../src/scenario-runner.ts';
test('all version-controlled scenarios match golden expectations', () => {
  for (const s of scenarios) {
    const r = runScenario(s);
    assert.equal(r.pass, true, `${s.id}: ${r.failures.join(', ')}`);
    assert.ok(r.view.audit.length >= 4, `${s.id}: incomplete audit`);
    assert.ok(r.view.outcomes.length >= 1, `${s.id}: missing outcome`);
  }
});
