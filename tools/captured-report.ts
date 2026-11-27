// Lists which Razorpay test-mode event types have been captured, and runs each one
// through the real webhook processor.   npm run captured:report
import { loadCaptured, replayCaptured, WANTED_EVENTS } from './capture/replay.ts';

const events = loadCaptured();
const byType = new Map<string, number>();
for (const e of events) byType.set(e.event, (byType.get(e.event) ?? 0) + 1);

console.log(`Captured test-mode events: ${events.length}`);
for (const type of WANTED_EVENTS)
  console.log(
    `  ${byType.has(type) ? 'captured' : 'missing '}  ${type}${byType.has(type) ? ` x${byType.get(type)}` : ''}`,
  );
for (const [type, n] of byType)
  if (!WANTED_EVENTS.includes(type)) console.log(`  extra     ${type} x${n}`);

if (events.length) {
  console.log('\nReplay through signature check, dedup and projection:');
  for (const r of replayCaptured(events))
    console.log(
      `  ${r.file}  ${r.event}  ${r.status}${r.caseState ? ` -> case ${r.caseState}` : ''}`,
    );
}
