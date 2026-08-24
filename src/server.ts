import { pathToFileURL } from 'node:url';
import { formatConfigError, parseRuntimeConfig } from './config.ts';
import { createRuntime } from './runtime.ts';

export async function startServer(modeOverride?: string) {
  const config = parseRuntimeConfig(process.env, modeOverride);
  const runtime = createRuntime(config);
  try {
    await runtime.listen();
  } catch (error) {
    await runtime.shutdown();
    throw error;
  }
  const address = runtime.server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  console.log(`Recovery workspace ready in ${config.mode} mode on ${config.host}:${port}`);
  return runtime;
}

export function installShutdownHandlers(runtime: Awaited<ReturnType<typeof startServer>>) {
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`Received ${signal}; closing HTTP and SQLite resources.`);
    try {
      await runtime.shutdown();
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));
}

async function main() {
  try {
    const runtime = await startServer(process.argv[2]);
    installShutdownHandlers(runtime);
  } catch (error) {
    console.error(formatConfigError(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
