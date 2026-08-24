import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('public/index.html', 'utf8');
const script = readFileSync('public/app.js', 'utf8');
const css = readFileSync('public/app.css', 'utf8');

test('merchant workspace contains every documented vertical-slice view', () => {
  for (const page of ['overview-page', 'cases-page', 'evaluation-page', 'audit-page']) {
    assert.match(html, new RegExp(`id="${page}"`));
  }
  assert.match(html, /id="case-dialog"/);
  assert.match(script, /Complete audit timeline/);
  assert.match(script, /Eligible actions/);
  assert.match(script, /Synthetic recovery/);
});

test('merchant controls use bounded server routes and explicit admin role', () => {
  assert.match(script, /\/suppress/);
  assert.match(script, /\/deliver/);
  assert.match(script, /x-merchant-role':'merchant_admin/);
  assert.doesNotMatch(script, /rzp_(?:test|live)_/);
});

test('dashboard is responsive and has no remote asset dependency', () => {
  assert.match(css, /@media\(max-width:720px\)/);
  assert.doesNotMatch(css, /https?:\/\//);
  assert.doesNotMatch(html, /https?:\/\//);
});
