import { createHash } from 'node:crypto';
import { AppError } from './errors.ts';
import {
  noopTelemetry,
  repositoryDelivery,
  systemClock,
  type Clock,
  type DeliveryExecutor,
  type ExistingCaseView,
  type RecoveryRepository,
  type Telemetry,
} from './ports.ts';
import type { Action, AuditEvent } from './types.ts';
export type MerchantRole = 'merchant_operator' | 'merchant_admin';
export type RecoveryDestination = { mode: 'simulated' } | { mode: 'trusted_url'; url: string };
export type MessagePreview = {
  templateVersion: string;
  channel: 'simulated_email';
  subject: string;
  body: string;
  recoveryDestination: RecoveryDestination;
};
const contactActions: Action[] = [
  'SEND_GENTLE_REMINDER',
  'SEND_ACTION_REQUIRED',
  'SURFACE_PAYMENT_UPDATE_LINK',
];
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 20);
export function validateRecoveryUrl(url: string, allowedDomains: string[]): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      allowedDomains.some(
        (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}
export function preview(
  action: Action,
  destination: RecoveryDestination = { mode: 'simulated' },
): MessagePreview | null {
  if (!contactActions.includes(action)) return null;
  if (destination.mode === 'trusted_url' && !validateRecoveryUrl(destination.url, ['razorpay.com']))
    throw new Error('untrusted recovery URL');
  const copy: Record<string, { subject: string; body: string }> = {
    SEND_GENTLE_REMINDER: {
      subject: 'A gentle payment reminder',
      body: 'Your recent subscription payment was not completed. Please review your payment method when convenient.',
    },
    SEND_ACTION_REQUIRED: {
      subject: 'Action needed for your subscription payment',
      body: 'Your subscription payment needs your attention. Please use the approved recovery flow to review your payment method.',
    },
    SURFACE_PAYMENT_UPDATE_LINK: {
      subject: 'Update your payment method securely',
      body: 'Please use the merchant-approved secure recovery flow to update your payment method.',
    },
  };
  return {
    templateVersion: 'recovery-en-v1',
    channel: 'simulated_email',
    ...copy[action]!,
    recoveryDestination: destination,
  };
}
export class MerchantExperience {
  readonly store: RecoveryRepository;
  readonly clock: Clock;
  readonly delivery: DeliveryExecutor;
  readonly telemetry: Telemetry;
  constructor(
    store: RecoveryRepository,
    clock = systemClock,
    delivery = repositoryDelivery(store),
    telemetry = noopTelemetry,
  ) {
    this.store = store;
    this.clock = clock;
    this.delivery = delivery;
    this.telemetry = telemetry;
  }
  queue() {
    return this.store.listCases().map((c) => ({
      id: c.id,
      state: c.state,
      subscriptionId: c.subscriptionId,
      amountMinor: c.amountMinor,
      currency: c.currency,
      contactCount: c.contactCount,
    }));
  }
  suppress(caseId: string, role: MerchantRole, at = this.clock.now()) {
    if (!['merchant_operator', 'merchant_admin'].includes(role))
      throw new AppError('FORBIDDEN', 'forbidden');
    const c = this.store.getCase(caseId);
    if (!c) throw new AppError('NOT_FOUND', 'case not found');
    if (c.state === 'RECOVERED' || c.state === 'CLOSED_CANCELLED')
      throw new AppError('CONFLICT', 'case terminal');
    if (c.state !== 'SUPPRESSED') this.store.saveCase({ ...c, state: 'SUPPRESSED' });
    this.audit(caseId, c.latestEventId, at, 'CASE_SUPPRESSED', { role });
    this.telemetry.record('case.suppressed', { caseId, role });
    return this.store.view(caseId) as ExistingCaseView;
  }
  override(caseId: string, action: Action, role: MerchantRole, at = this.clock.now()) {
    if (role !== 'merchant_admin') throw new AppError('FORBIDDEN', 'forbidden');
    const view = this.store.view(caseId);
    if (!view.case) throw new AppError('NOT_FOUND', 'case not found');
    if (['RECOVERED', 'CLOSED_CANCELLED', 'SUPPRESSED'].includes(view.case.state))
      throw new AppError('CONFLICT', 'case terminal');
    const latest = view.decisions.at(-1);
    if (!latest?.eligibleActions.includes(action))
      throw new AppError('CONFLICT', 'action not eligible');
    const key = `override:${caseId}:${latest.id}:${action}`;
    if (contactActions.includes(action)) {
      const message = preview(action);
      this.delivery.enqueue({
        id: `out_${hash(key)}`,
        key,
        caseId,
        action,
        payload: { simulated: true, message, override: true },
      });
    } else if (action === 'ESCALATE_TO_MERCHANT')
      this.delivery.enqueue({
        id: `out_${hash(key)}`,
        key,
        caseId,
        action,
        payload: { simulated: true, override: true },
      });
    this.audit(caseId, latest.eventId, at, 'OVERRIDE_RECORDED', { role, action, dispatchKey: key });
    this.telemetry.record('case.overridden', { caseId, role, action });
    return this.store.view(caseId) as ExistingCaseView;
  }
  markDelivered(outboxId: string, role: MerchantRole, at = this.clock.now()) {
    if (!['merchant_operator', 'merchant_admin'].includes(role))
      throw new AppError('FORBIDDEN', 'forbidden');
    const row = this.store.outboxItem(outboxId);
    if (!row) throw new AppError('NOT_FOUND', 'outbox item not found');
    this.store.markOutboxDelivered(outboxId);
    this.audit(row.case_id, 'simulated_delivery', at, 'DELIVERY_UPDATED', {
      outboxId,
      status: 'SIMULATED_DELIVERED',
      role,
    });
    this.telemetry.record('delivery.simulated', { outboxId, caseId: row.case_id });
    return this.store.view(row.case_id) as ExistingCaseView;
  }
  private audit(
    caseId: string,
    eventId: string,
    at: string,
    kind: AuditEvent['kind'],
    detail: Record<string, unknown>,
  ) {
    this.store.audit({
      id: `aud_${hash(`${caseId}:${eventId}:${kind}:${JSON.stringify(detail)}`)}`,
      caseId,
      eventId,
      at,
      kind,
      detail,
    });
  }
}
