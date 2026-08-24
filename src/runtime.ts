import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApplication } from './application.ts';
import type { RuntimeConfig } from './config.ts';
import { createHttpApp } from './http-app.ts';
import { systemClock, type Clock, type Telemetry } from './ports.ts';
import { seedDemoFixtures } from './seeding.ts';
import { Store } from './store.ts';

export type RuntimeDependencies = {
  clock?: Clock;
  telemetry?: Telemetry;
};

export function createRuntime(config: RuntimeConfig, dependencies: RuntimeDependencies = {}) {
  mkdirSync(dirname(config.dataPath), { recursive: true });
  const repository = new Store(config.dataPath);
  const application = createApplication({
    repository,
    clock: dependencies.clock ?? systemClock,
    ...(dependencies.telemetry ? { telemetry: dependencies.telemetry } : {}),
    webhookSecret: config.webhookEnabled ? config.webhookSecret : '',
  });
  if (config.seedFixtures) seedDemoFixtures(application);
  const server = createHttpApp({
    application,
    publicDir: config.publicDir,
    readinessConfig: {
      webhookSecret: config.webhookEnabled ? config.webhookSecret : '',
      publicBaseUrl: config.publicBaseUrl,
      modelProvider: config.modelProvider,
      modelName: config.modelName,
      modelApiKey: config.modelApiKey,
    },
  });
  let shutdownPromise: Promise<void> | undefined;
  return {
    config,
    application,
    server,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(config.port, config.host, () => {
          server.off('error', onError);
          resolve();
        });
      });
      return server.address();
    },
    shutdown() {
      shutdownPromise ??= new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          application.close();
          if (error) reject(error);
          else resolve();
        };
        if (!server.listening) {
          finish();
          return;
        }
        server.close((error) => finish(error));
      });
      return shutdownPromise;
    },
  };
}

export type ApplicationRuntime = ReturnType<typeof createRuntime>;
