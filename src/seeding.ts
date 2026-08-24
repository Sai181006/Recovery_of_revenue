import { scenarios } from '../fixtures/scenarios.ts';
import type { RevenueRecoveryApplication } from './application.ts';

export function seedDemoFixtures(application: RevenueRecoveryApplication) {
  for (const scenario of scenarios) {
    for (const event of scenario.events) application.pipeline.process(event, scenario.now);
  }
  return application.repository.counts();
}
