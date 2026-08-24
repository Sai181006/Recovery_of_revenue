import test from 'node:test';
import assert from 'node:assert/strict';
import { readiness } from '../src/readiness.ts';
test('fixture demo is ready while unavailable integrations are explicit', () => {
  const value = readiness({});
  assert.equal(value.fixtureDemoReady, true);
  assert.equal(value.integratedDemoReady, false);
  assert.equal(value.integrations.customerDelivery, 'simulated');
  assert.ok(value.integratedDemoBlockers.length >= 4);
});
test('configured values improve diagnostics but genuine lifecycle remains an explicit blocker', () => {
  const value = readiness({
    webhookSecret: 'local-test',
    publicBaseUrl: 'https://demo.example.invalid',
    modelProvider: 'provider',
    modelName: 'model',
    modelApiKey: 'local-test',
  });
  assert.equal(value.integrations.razorpayWebhook, true);
  assert.equal(value.integrations.publicHttpsEndpoint, true);
  assert.equal(value.integrations.liveAdvisor, true);
  assert.equal(value.integratedDemoReady, false);
  assert.deepEqual(value.integratedDemoBlockers, [
    'genuine Razorpay test lifecycle not yet captured',
  ]);
});
