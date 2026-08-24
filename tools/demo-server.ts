import { formatConfigError, parseRuntimeConfig } from '../src/config.ts';
import { resetDemoDatabase } from '../src/demo-data.ts';
import { installShutdownHandlers, startServer } from '../src/server.ts';

const mode = process.argv[2] === 'demo' ? 'demo' : 'development';

try {
  const config = parseRuntimeConfig(process.env, mode);
  resetDemoDatabase(config.dataPath);
  const runtime = await startServer(mode);
  installShutdownHandlers(runtime);
} catch (error) {
  console.error(formatConfigError(error));
  process.exitCode = 1;
}
