import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const allowed = ['recovery.sqlite', 'recovery.sqlite-shm', 'recovery.sqlite-wal'];

export function resetDemoDatabase(dataPath = resolve('data', 'recovery.sqlite')) {
  const database = resolve(dataPath);
  const dataDir = dirname(database);
  if (basename(database) !== 'recovery.sqlite') {
    throw new Error(`unsafe demo data target: ${database}`);
  }
  mkdirSync(dataDir, { recursive: true });
  for (const suffix of ['', '-shm', '-wal']) {
    const target = `${database}${suffix}`;
    if (dirname(target) !== dataDir || !allowed.includes(basename(target))) {
      throw new Error(`unsafe demo data target: ${target}`);
    }
    if (existsSync(target)) rmSync(target);
  }
  return dataDir;
}
