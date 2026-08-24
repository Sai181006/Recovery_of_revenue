import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createApplication } from '../src/application.ts';
import { formatConfigError, parseRuntimeConfig } from '../src/config.ts';
import { AppError, toHttpError } from '../src/errors.ts';
import { MemoryStore } from '../src/memory-store.ts';
import { createRuntime } from '../src/runtime.ts';
import type { RecoveryEvent } from '../src/types.ts';

const temporaryRoots: string[] = [];
const temporaryRoot = () => {
  const path = mkdtempSync(join(tmpdir(), 'revenue-recovery-phase7-'));
  temporaryRoots.push(path);
  return path;
};

test.after(() => {
  for (const path of temporaryRoots) rmSync(path, { recursive: true, force: true });
});

test('application, HTTP, and server imports have no startup, seed, or filesystem side effects', () => {
  const cwd = temporaryRoot();
  const imports = ['src/application.ts', 'src/http-app.ts', 'src/api.ts', 'src/server.ts'].map(
    (path) => pathToFileURL(resolve(path)).href,
  );
  execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      `await Promise.all(${JSON.stringify(imports)}.map(value => import(value)))`,
    ],
    { cwd, stdio: 'pipe' },
  );
  assert.equal(existsSync(join(cwd, 'data')), false);
});

test('production-style runtime creates an empty repository and no synthetic cases', async () => {
  const root = temporaryRoot();
  const config = parseRuntimeConfig(
    { DATA_PATH: join(root, 'production.sqlite'), PORT: '0' },
    'production',
    root,
  );
  const runtime = createRuntime(config);
  assert.deepEqual(runtime.application.repository.counts(), { inbox: 0, outbox: 0 });
  assert.deepEqual(runtime.application.experience.queue(), []);
  await runtime.shutdown();
});

test('demo and development runtimes seed the same deterministic fixture state', async () => {
  const root = temporaryRoot();
  const first = createRuntime(
    parseRuntimeConfig({ DATA_PATH: join(root, 'demo.sqlite'), PORT: '0' }, 'demo', root),
  );
  const second = createRuntime(
    parseRuntimeConfig(
      { DATA_PATH: join(root, 'development.sqlite'), PORT: '0' },
      'development',
      root,
    ),
  );
  assert.deepEqual(first.application.repository.counts(), second.application.repository.counts());
  assert.deepEqual(first.application.experience.queue(), second.application.experience.queue());
  assert.equal(first.application.experience.queue().length, 14);
  await first.shutdown();
  await second.shutdown();
});

test('invalid configuration fails closed and diagnostics never contain secret values', () => {
  const secret = 'do-not-leak-this-model-secret';
  let error: unknown;
  try {
    parseRuntimeConfig({ PORT: 'not-a-port', MODEL_API_KEY: secret }, 'production');
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'CONFIG_INVALID');
  const diagnostic = formatConfigError(error);
  assert.match(diagnostic, /CONFIG_INVALID/);
  assert.match(diagnostic, /PORT/);
  assert.doesNotMatch(diagnostic, new RegExp(secret));
  assert.throws(
    () => parseRuntimeConfig({ WEBHOOK_ENABLED: 'true' }, 'production'),
    (caught: unknown) => caught instanceof AppError && caught.code === 'CONFIG_INVALID',
  );
});

test('application services use an in-memory repository and injected clock without a port', () => {
  const now = '2026-08-24T10:15:30.000Z';
  const repository = new MemoryStore();
  const application = createApplication({ repository, clock: { now: () => now } });
  const event: RecoveryEvent = {
    schemaVersion: '1.0',
    eventId: 'evt_injected_clock',
    merchantId: 'merchant_demo',
    subscriptionId: 'sub_injected_clock',
    customerRef: 'customer_injected_clock',
    type: 'subscription.pending',
    occurredAt: '2026-08-24T09:00:00.000Z',
    receivedAt: '2026-08-24T09:00:01.000Z',
    amountMinor: 129900,
    currency: 'INR',
    consent: true,
    suppressed: false,
    contactAvailable: true,
    identityConsistent: true,
    rawFailure: { source: 'customer', reason: 'insufficient_funds' },
  };
  const view = application.pipeline.process(event);
  assert.equal(view.decisions[0].decidedAt, now);
  assert.equal(view.case.state, 'OPEN_PENDING');
  assert.equal(repository.counts().outbox, 1);
  application.close();
});

test('graceful shutdown closes HTTP and repository resources exactly once', async () => {
  const root = temporaryRoot();
  const telemetry: string[] = [];
  const runtime = createRuntime(
    parseRuntimeConfig(
      { DATA_PATH: join(root, 'lifecycle.sqlite'), PORT: '0' },
      'production',
      root,
    ),
    { telemetry: { record: (name) => telemetry.push(name) } },
  );
  await runtime.listen();
  assert.equal(runtime.server.listening, true);
  await Promise.all([runtime.shutdown(), runtime.shutdown()]);
  assert.equal(runtime.server.listening, false);
  assert.equal(telemetry.filter((name) => name === 'application.closed').length, 1);
  assert.throws(() => runtime.application.repository.counts());
});

test('central HTTP error mapping exposes stable codes and hides internal details', () => {
  assert.deepEqual(toHttpError(new AppError('FORBIDDEN', 'sensitive internal reason')), {
    status: 403,
    body: {
      error: 'FORBIDDEN',
      code: 'FORBIDDEN',
      message: 'The operation is not permitted.',
    },
  });
  const unknown = toHttpError(new Error('database path and internal details'));
  assert.equal(unknown.body.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(unknown), /database path/);
});
