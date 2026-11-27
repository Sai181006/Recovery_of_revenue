import { createHash, createHmac } from 'node:crypto';

/**
 * Re-signing key for committed fixtures. NOT a Razorpay secret: the real webhook
 * secret is only used at capture time to prove each event was genuinely signed by
 * Razorpay, and is never written anywhere.
 */
export const FIXTURE_SIGNING_KEY = 'fixture-resign-key-not-a-razorpay-credential';

export type CapturedEvent = {
  source: 'razorpay-test-mode';
  /** True only if the original bytes matched the real webhook secret at capture time. */
  verifiedAtCapture: true;
  capturedAt: string;
  event: string;
  /** Hashed X-Razorpay-Event-Id (stable, so redelivery dedup can still be tested). */
  eventId: string;
  /** Redacted payload, exactly the bytes that fixtureSignature covers. */
  body: string;
  fixtureSignature: string;
};

// Keys whose whole value is dropped: contact details, payment instruments,
// account identifiers, and free-form notes (which can hold anything).
const DROP_KEYS =
  /^(email|contact|phone|mobile|name|vpa|card|bank|bank_account|account_id|notes|address|billing_address|shipping_address|token|acquirer_data|ip|customer_details)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// A standalone run of 10+ digits (optionally +, spaces, dashes), not part of an id.
const PHONE = /(?<![A-Za-z0-9_])\+?\d[\d\s-]{8,}\d(?![A-Za-z0-9_])/g;
const KEY_ID = /rzp_(?:test|live)_[A-Za-z0-9]+/g;
const ACCOUNT = /\bacc_[A-Za-z0-9]+/g;
// Razorpay object ids are replaced by stable hashes so events about the same
// subscription still correlate, without publishing the account's real ids.
const OBJECT_ID = /\b(sub|pay|cust|plan|inv|order|evt|card|token|item)_[A-Za-z0-9]{6,}/g;

export const hashId = (id: string) =>
  `${id.slice(0, id.indexOf('_'))}_r${createHash('sha256').update(id).digest('hex').slice(0, 14)}`;

function redactString(value: string) {
  return value
    .replace(EMAIL, '[REDACTED_EMAIL]')
    .replace(KEY_ID, '[REDACTED_KEY]')
    .replace(ACCOUNT, '[REDACTED_ACCOUNT]')
    .replace(PHONE, '[REDACTED_PHONE]')
    .replace(OBJECT_ID, (id) => hashId(id));
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, item]) => [key, ...strings(item)]);
  return [];
}

export function redactCapture(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactCapture);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      DROP_KEYS.test(key) ? '[REDACTED]' : redactCapture(item),
    ]),
  );
}

/**
 * Patterns that must never appear in a committed capture. Checks every string
 * (keys and values) in the JSON, not numbers, so timestamps and amounts don't
 * look like phone numbers.
 */
export function leaks(body: string): string[] {
  const texts = strings(JSON.parse(body));
  const found: string[] = [];
  for (const [name, pattern] of [
    ['email', EMAIL],
    ['key id', KEY_ID],
    ['account id', ACCOUNT],
    ['phone', PHONE],
  ] as const) {
    if (
      texts.some((t) => {
        pattern.lastIndex = 0;
        return pattern.test(t);
      })
    )
      found.push(name);
  }
  return found;
}

export function toFixture(rawPayload: unknown, eventId: string, capturedAt: string): CapturedEvent {
  const redacted = redactCapture(rawPayload) as { event?: unknown };
  const body = JSON.stringify(redacted);
  return {
    source: 'razorpay-test-mode',
    verifiedAtCapture: true,
    capturedAt,
    event: typeof redacted.event === 'string' ? redacted.event : 'unknown',
    eventId: hashId(eventId.startsWith('evt_') ? eventId : `evt_${eventId}`),
    body,
    fixtureSignature: createHmac('sha256', FIXTURE_SIGNING_KEY).update(body).digest('hex'),
  };
}
