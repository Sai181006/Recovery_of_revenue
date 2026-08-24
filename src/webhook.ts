import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Pipeline } from './pipeline.ts';
import {
  noopTelemetry,
  systemClock,
  type Clock,
  type RecoveryRepository,
  type Telemetry,
} from './ports.ts';
import type { RecoveryEvent } from './types.ts';

export type WebhookContext = {
  merchantId: string;
  consent: boolean;
  suppressed: boolean;
  contactAvailable: boolean;
  trustedUpdateLinkAvailable: boolean;
};
export type WebhookResult = {
  receiptId: string;
  eventId: string;
  verification: 'VERIFIED' | 'INVALID';
  processingStatus:
    | 'PROCESSED'
    | 'DUPLICATE'
    | 'REJECTED'
    | 'MALFORMED'
    | 'UNSUPPORTED'
    | 'RECONCILIATION_REQUIRED';
  caseId?: string;
  error?: string;
};
const supported = new Set([
  'subscription.pending',
  'subscription.charged',
  'subscription.halted',
  'subscription.cancelled',
  'subscription.paused',
  'subscription.resumed',
]);
const sensitive =
  /(card|cvv|pin|pan|token|secret|signature|authorization|email|phone|contact|vpa|bank_account)/i;
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);

export function verifySignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sensitive.test(key) ? '[REDACTED]' : redact(item),
    ]),
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected object');
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`missing ${name}`);
  return value;
}
function optionalText(value: unknown) {
  return typeof value === 'string' && value ? value : undefined;
}
export function mapRazorpayEvent(
  payload: unknown,
  eventId: string,
  receivedAt: string,
  context: WebhookContext,
): RecoveryEvent {
  const root = object(payload);
  const type = text(root.event, 'event');
  if (!supported.has(type)) throw new Error('unsupported event');
  const envelope = object(root.payload);
  const subscription = object(object(envelope.subscription).entity);
  const payment = envelope.payment ? object(object(envelope.payment).entity) : {};
  const created =
    typeof root.created_at === 'number'
      ? new Date(root.created_at * 1000).toISOString()
      : receivedAt;
  const amount =
    typeof payment.amount === 'number'
      ? payment.amount
      : typeof subscription.amount === 'number'
        ? subscription.amount
        : 0;
  const code = optionalText(payment.error_code);
  const description = optionalText(payment.error_description);
  const source = optionalText(payment.error_source);
  const step = optionalText(payment.error_step);
  const reason = optionalText(payment.error_reason);
  const paymentId = optionalText(payment.id);
  const rawFailure = {
    ...(code ? { code } : {}),
    ...(description ? { description } : {}),
    ...(source ? { source } : {}),
    ...(step ? { step } : {}),
    ...(reason ? { reason } : {}),
    ...(paymentId ? { metadata: { paymentId } } : {}),
  };
  const event: RecoveryEvent = {
    schemaVersion: '1.0',
    eventId,
    merchantId: context.merchantId,
    subscriptionId: text(subscription.id, 'subscription.id'),
    customerRef:
      optionalText(subscription.customer_id) ??
      `anonymous_${digest(text(subscription.id, 'subscription.id'))}`,
    type: type as RecoveryEvent['type'],
    occurredAt: created,
    receivedAt,
    amountMinor: amount,
    currency: optionalText(payment.currency) ?? 'INR',
    consent: context.consent,
    suppressed: context.suppressed,
    contactAvailable: context.contactAvailable,
    identityConsistent: true,
    trustedUpdateLinkAvailable: context.trustedUpdateLinkAvailable,
  };
  if (Object.values(rawFailure).some((value) => value !== undefined)) event.rawFailure = rawFailure;
  return event;
}
export class WebhookProcessor {
  readonly store: RecoveryRepository;
  readonly pipeline: Pipeline;
  readonly secret: string;
  readonly context: WebhookContext;
  readonly clock: Clock;
  readonly telemetry: Telemetry;
  constructor(
    store: RecoveryRepository,
    pipeline: Pipeline,
    secret: string,
    context: WebhookContext,
    clock = systemClock,
    telemetry = noopTelemetry,
  ) {
    this.store = store;
    this.pipeline = pipeline;
    this.secret = secret;
    this.context = context;
    this.clock = clock;
    this.telemetry = telemetry;
  }
  process(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
    receivedAt = this.clock.now(),
  ): WebhookResult {
    const eventId = headers['x-razorpay-event-id'] ?? `missing_${digest(rawBody.toString('utf8'))}`;
    const receiptId = `receipt_${digest(`${eventId}:${receivedAt}:${rawBody.toString('base64')}`)}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      parsed = { malformed: true };
    }
    const redacted = redact(parsed);
    const valid = verifySignature(rawBody, headers['x-razorpay-signature'], this.secret);
    this.store.recordWebhookReceipt({
      receiptId,
      eventId,
      receivedAt,
      verification: valid ? 'VERIFIED' : 'INVALID',
      processingStatus: valid ? 'RECEIVED' : 'REJECTED',
      redactedPayload: redacted,
    });
    if (!valid) {
      this.telemetry.record('webhook.rejected', { eventId, reason: 'invalid_signature' });
      return {
        receiptId,
        eventId,
        verification: 'INVALID',
        processingStatus: 'REJECTED',
        error: 'invalid signature',
      };
    }
    if (!headers['x-razorpay-event-id']) {
      this.store.updateWebhookReceipt(receiptId, 'RECONCILIATION_REQUIRED', 'missing event id');
      return {
        receiptId,
        eventId,
        verification: 'VERIFIED',
        processingStatus: 'RECONCILIATION_REQUIRED',
        error: 'missing event id',
      };
    }
    try {
      const event = mapRazorpayEvent(parsed, eventId, receivedAt, this.context);
      this.pipeline.process(event, receivedAt);
      const status = this.store.isDuplicateReceipt(eventId) ? 'DUPLICATE' : 'PROCESSED';
      this.store.updateWebhookReceipt(receiptId, status);
      this.telemetry.record('webhook.processed', { eventId, status });
      return {
        receiptId,
        eventId,
        verification: 'VERIFIED',
        processingStatus: status,
        caseId: `${event.merchantId}:${event.subscriptionId}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'mapping failed';
      const status =
        message === 'unsupported event'
          ? 'UNSUPPORTED'
          : message.startsWith('missing')
            ? 'RECONCILIATION_REQUIRED'
            : 'MALFORMED';
      this.store.updateWebhookReceipt(receiptId, status, message);
      return {
        receiptId,
        eventId,
        verification: 'VERIFIED',
        processingStatus: status,
        error: message,
      };
    }
  }
}
