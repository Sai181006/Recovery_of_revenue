import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const required = [
  'README.md',
  '.env.example',
  'docs/ARCHITECTURE.md',
  'docs/DEMO_RUNBOOK.md',
  'docs/LIMITATIONS.md',
  'docs/SUBMISSION_CHECKLIST.md',
  'reports/evaluation-v1.json',
];
const ignored = new Set(['.git', '.npm-cache', 'node_modules', 'data']);
const files = walk('.').filter(
  (path) => !path.startsWith('reports\\') || path.endsWith('evaluation-v1.json'),
);
function walk(path) {
  return readdirSync(path).flatMap((name) => {
    if (ignored.has(name)) return [];
    const item = join(path, name);
    return statSync(item).isDirectory() ? walk(item) : [item.replace(/^\.\\/, '')];
  });
}
const failures = [];
for (const path of required)
  if (!existsSync(path)) failures.push(`missing required artifact: ${path}`);
const secretPatterns = [
  /rzp_live_[A-Za-z0-9]+/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:KEY_SECRET|WEBHOOK_SECRET|API_KEY)[ \t]*=[ \t]*[^ \t\r\n#]+/,
];
for (const path of files) {
  const source = readFileSync(path, 'utf8');
  for (const pattern of secretPatterns)
    if (pattern.test(source)) failures.push(`${path}: possible secret`);
}
for (const path of ['data/recovery.sqlite', 'data/recovery.sqlite-shm', 'data/recovery.sqlite-wal'])
  if (existsSync(path) && !isIgnored(path))
    failures.push(`${path}: generated database is not ignored`);
function isIgnored(path) {
  const ignore = readFileSync('.gitignore', 'utf8');
  return ignore.includes('data/*.sqlite*') && path.startsWith('data/recovery.sqlite');
}
if (existsSync('reports/evaluation-v1.json')) {
  const report = JSON.parse(readFileSync('reports/evaluation-v1.json', 'utf8'));
  if (report.releaseGate?.passed !== true) failures.push('evaluation release gate failed');
  if (!String(report.outcomeRule).includes('not observed revenue or causal lift'))
    failures.push('synthetic outcome disclaimer missing');
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Release audit passed: ${required.length} required artifacts, ${files.length} files scanned, evaluation gate green.`,
  );
