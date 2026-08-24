import { createApplication } from '../src/application.ts';
import { resetDemoDatabase } from '../src/demo-data.ts';
import { systemClock } from '../src/ports.ts';
import { seedDemoFixtures } from '../src/seeding.ts';
import { Store } from '../src/store.ts';

const database = 'data/recovery.sqlite';

function reset() {
  const dataDir = resetDemoDatabase(database);
  console.log(`Reset demo database files in ${dataDir}`);
}

function seed() {
  reset();
  const application = createApplication({
    repository: new Store(database),
    clock: systemClock,
  });
  const counts = seedDemoFixtures(application);
  application.close();
  console.log(
    `Seeded 14 scenarios: ${counts.inbox} inbox receipts, ${counts.outbox} simulated outbox items`,
  );
}

if (process.argv[2] === 'reset') reset();
else if (process.argv[2] === 'seed') seed();
else {
  console.error('Usage: npm run demo:reset | npm run demo:seed');
  process.exitCode = 2;
}
