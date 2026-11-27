// Captures real Razorpay TEST-MODE webhooks into fixtures/captured/, redacted.
//
//   npm run capture:webhooks      (reads RAZORPAY_WEBHOOK_SECRET from .env)
//
// Expose the port with an HTTPS tunnel and set the tunnel URL as the webhook URL in
// the Razorpay test-mode dashboard. See docs/RAZORPAY_TEST_MODE.md.
// Only deliveries whose signature matches the real secret are written. The secret,
// raw body and original ids are never written to disk.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { verifySignature } from '../src/webhook.ts';
import { leaks, toFixture } from './capture/redact.ts';

const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
const keyId = process.env.RAZORPAY_KEY_ID?.trim();
const port = Number(process.env.CAPTURE_PORT ?? '3001');
const outDir = join('fixtures', 'captured');

if (!secret) {
  console.error('RAZORPAY_WEBHOOK_SECRET is not set. Put the test-mode webhook secret in .env.');
  process.exit(1);
}
if (keyId && !keyId.startsWith('rzp_test_')) {
  console.error('RAZORPAY_KEY_ID is not a test-mode key. Capture only runs against test mode.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
let count = readdirSync(outDir).filter((f) => f.endsWith('.json')).length;

const header = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks);
  const eventId = header(req.headers['x-razorpay-event-id']);
  if (!verifySignature(raw, header(req.headers['x-razorpay-signature']), secret)) {
    console.warn('Rejected: signature does not match RAZORPAY_WEBHOOK_SECRET (not written).');
    res.writeHead(401).end();
    return;
  }
  if (!eventId) {
    console.warn('Verified delivery without X-Razorpay-Event-Id; not written.');
    res.writeHead(200).end();
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    console.warn('Verified delivery with a non-JSON body; not written.');
    res.writeHead(200).end();
    return;
  }
  const fixture = toFixture(payload, eventId, new Date().toISOString());
  const found = leaks(fixture.body);
  if (found.length) {
    console.error(`Not written: redacted body still looks like it contains: ${found.join(', ')}`);
    res.writeHead(200).end();
    return;
  }
  count += 1;
  const file = join(outDir, `${String(count).padStart(3, '0')}-${fixture.event}.json`);
  writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`Captured ${fixture.event} -> ${file}`);
  res.writeHead(200).end();
}).listen(port, '127.0.0.1', () => {
  console.log(`Capturing verified test-mode webhooks on http://127.0.0.1:${port} (Ctrl+C to stop)`);
});
