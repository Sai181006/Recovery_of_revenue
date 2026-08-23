import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src', 'fixtures', 'test'];
const files = roots.flatMap(walk).sort();
const mode = process.argv[2];

function walk(path) {
  return readdirSync(path).flatMap((name) => {
    const candidate = join(path, name);
    return statSync(candidate).isDirectory()
      ? walk(candidate)
      : candidate.endsWith('.ts')
        ? [candidate]
        : [];
  });
}

if (mode === 'syntax') {
  for (const file of files) {
    execFileSync(process.execPath, ['--experimental-strip-types', '--check', file], {
      stdio: 'inherit',
    });
  }
  console.log(`Checked TypeScript syntax for ${files.length} files.`);
} else if (mode === 'lint') {
  const violations = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (/\b(eval|Function)\s*\(/.test(source)) violations.push(`${file}: dynamic code`);
    if (/\b(PAN|CVV|PIN)\s*[:=]/i.test(source)) violations.push(`${file}: payment credential field`);
    if (/https?:\/\/(?!localhost)/.test(source)) violations.push(`${file}: external URL`);
    if (/\bfetch\s*\(/.test(source)) violations.push(`${file}: external integration`);
  }
  if (violations.length) throw new Error(violations.join('\n'));
  console.log(`Linted ${files.length} files; no forbidden Phase 0/1 constructs found.`);
} else if (mode === 'format' || mode === 'format-check') {
  const changed = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const formatted = `${source.replace(/[ \t]+$/gm, '').trimEnd()}\n`;
    if (source !== formatted) {
      changed.push(file);
      if (mode === 'format') writeFileSync(file, formatted);
    }
  }
  if (mode === 'format-check' && changed.length) {
    throw new Error(`Formatting required: ${changed.join(', ')}`);
  }
  console.log(`${mode === 'format' ? 'Formatted' : 'Checked formatting for'} ${files.length} files.`);
} else {
  throw new Error('Expected syntax, lint, format, or format-check');
}
