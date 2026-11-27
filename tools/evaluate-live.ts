// Runs the live Claude advisor on the 14 SYNTHETIC scenarios and compares it with
// the fixed rules. Costs real API usage (one short request per distinct input).
//
//   npm run evaluate:live            (credentials: ANTHROPIC_API_KEY or `ant auth login`)
//   ADVISOR_MODEL=... npm run evaluate:live
//
// Writes reports/evaluation-live.json and prints the numbers as they come out,
// including when the live advisor is no better than the fixed rules.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClaudeAdvisor } from '../src/adapters/claude-advisor.ts';
import { evaluateLive } from './live-evaluation.ts';

const model = process.env.ADVISOR_MODEL?.trim() || undefined;
const report = await evaluateLive(createClaudeAdvisor(model ? { model } : {}));
const out = { generatedAt: new Date().toISOString(), ...report };
mkdirSync('reports', { recursive: true });
writeFileSync('reports/evaluation-live.json', `${JSON.stringify(out, null, 2)}\n`);

const row = (name: string, m: (typeof report.metrics)['fixed_rule']) =>
  `${name}: ${m.cases} cases, ${m.contacts} contacts, ${m.syntheticRecovered} synthetic recoveries, ${m.criticalViolations} critical violations`;
console.log(
  `Model: ${report.advisor.model} (${report.dataset}; synthetic scenarios, not real outcomes)`,
);
console.log(row('fixed_rule  ', report.metrics.fixed_rule));
console.log(row('live_advisor', report.metrics.live_advisor));
console.log(`Model calls: ${report.modelCalls}, errors/timeouts/refusals: ${report.modelErrors}`);
console.log(`Decision sources: ${JSON.stringify(report.decisionSources)}`);
console.log(`Rejected outputs: ${JSON.stringify(report.rejectedOutputs)}`);
console.log('Wrote reports/evaluation-live.json');
