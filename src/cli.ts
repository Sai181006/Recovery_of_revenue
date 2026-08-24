import { scenarios } from '../fixtures/scenarios.ts';
import { writeReport } from './evaluation.ts';
import { runScenario } from './scenario-runner.ts';
if (process.argv[2] === 'scenarios') {
  const results = scenarios.map(runScenario);
  for (const r of results)
    console.log(
      `${r.pass ? 'PASS' : 'FAIL'} ${r.id}${r.failures.length ? `: ${r.failures.join(', ')}` : ''}`,
    );
  const passed = results.filter((x) => x.pass).length;
  console.log(`\n${passed}/${results.length} deterministic scenarios passed`);
  if (passed !== results.length) process.exitCode = 1;
} else if (process.argv[2] === 'evaluate') {
  const report = writeReport();
  console.log(`Release gate: ${report.releaseGate.passed ? 'PASS' : 'FAIL'}`);
  for (const [strategy, metrics] of Object.entries(report.metrics))
    console.log(
      `${strategy}: ${metrics.cases} cases, ${metrics.contacts} contacts, ${metrics.syntheticRecovered} synthetic recoveries, ${metrics.criticalViolations} critical violations`,
    );
  console.log('Wrote reports/evaluation-v1.json');
  if (!report.releaseGate.passed) process.exitCode = 1;
} else {
  console.error('Usage: npm run scenarios | npm run evaluate');
  process.exitCode = 2;
}
