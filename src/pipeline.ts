import { createHash } from 'node:crypto';
import { advise, type Advisor } from './advisor.ts';
import { preview } from './experience.ts';
import { normalizeFailure } from './normalize.ts';
import { evaluate, isContact, prohibited, selectAction } from './policy.ts';
import {
  noopTelemetry,
  repositoryDelivery,
  type Clock,
  type DeliveryExecutor,
  type ExistingCaseView,
  type RecoveryRepository,
  type Telemetry,
} from './ports.ts';
import type {
  AuditEvent,
  CaseState,
  Decision,
  Outcome,
  Policy,
  RecoveryCase,
  RecoveryEvent,
} from './types.ts';
const rank: Record<string, number> = {
  unknown: 0,
  pending: 1,
  paused: 2,
  halted: 3,
  active: 4,
  cancelled: 5,
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 20);
export class Pipeline {
  readonly store: RecoveryRepository;
  readonly policy: Policy;
  readonly advisor: Advisor | undefined;
  readonly clock: Clock | undefined;
  readonly delivery: DeliveryExecutor;
  readonly telemetry: Telemetry;
  constructor(
    store: RecoveryRepository,
    policy: Policy,
    advisor?: Advisor,
    clock?: Clock,
    delivery = repositoryDelivery(store),
    telemetry = noopTelemetry,
  ) {
    this.store = store;
    this.policy = policy;
    this.advisor = advisor;
    this.clock = clock;
    this.delivery = delivery;
    this.telemetry = telemetry;
  }
  process(e: RecoveryEvent, at?: string) {
    const now = at ?? this.clock?.now() ?? e.receivedAt;
    const caseId = `${e.merchantId}:${e.subscriptionId}`;
    this.addAudit(caseId, e, 'EVENT_RECEIVED', {});
    if (!this.store.ingest(e)) {
      this.addAudit(caseId, e, 'DUPLICATE_IGNORED', {});
      this.telemetry.record('event.duplicate', { eventId: e.eventId, caseId });
      return this.existingView(caseId);
    }
    const old = this.store.getCase(caseId);
    const nextSub = this.subState(e);
    const stale = Boolean(old && new Date(e.occurredAt) < new Date(old.stateOccurredAt));
    let c: RecoveryCase;
    if (
      old &&
      (stale ||
        (rank[nextSub] ?? 0) < (rank[old.subscriptionState] ?? 0) ||
        (old.state === 'SUPPRESSED' && !['active', 'cancelled'].includes(nextSub)))
    ) {
      c = old;
      this.addAudit(caseId, e, 'STALE_EVENT_IGNORED', {
        incoming: nextSub,
        current: old.subscriptionState,
        preservedSuppression: old.state === 'SUPPRESSED',
      });
    } else {
      const failure = e.rawFailure ? normalizeFailure(e.rawFailure) : old?.failure;
      const state = this.caseState(e, nextSub, failure?.contradictory ?? false);
      c = {
        id: caseId,
        merchantId: e.merchantId,
        subscriptionId: e.subscriptionId,
        customerRef: e.customerRef,
        state,
        subscriptionState: nextSub,
        stateOccurredAt: e.occurredAt,
        amountMinor: e.amountMinor,
        currency: e.currency,
        contactCount: old?.contactCount ?? 0,
        latestEventId: e.eventId,
        ...(old?.lastContactAt ? { lastContactAt: old.lastContactAt } : {}),
        ...(failure ? { failure } : {}),
      };
      this.store.saveCase(c);
      this.addAudit(caseId, e, 'PROJECTION_UPDATED', { state });
    }
    const result = evaluate(c, e, this.policy, now),
      fallback = selectAction(result.eligible),
      advisory = advise(c, result.eligible, this.policy, fallback, this.advisor),
      selected = advisory.selectedAction;
    const d: Decision = {
      id: `dec_${hash(e.eventId)}`,
      caseId,
      eventId: e.eventId,
      policyVersion: this.policy.version,
      decidedAt: now,
      eligibleActions: result.eligible,
      selectedAction: selected,
      prohibitedActions: prohibited(result.eligible),
      reasonCodes: [...result.reasons, ...advisory.reasonCodes],
      selectorVersion: this.advisor ? 'advisor-gate-v1' : 'fixed-v1',
      selectionSource: advisory.source,
      rationale: advisory.rationale,
      confidence: advisory.confidence,
      inputHash: advisory.inputHash,
      ...(advisory.advisorName ? { advisorName: advisory.advisorName } : {}),
      ...(advisory.advisorVersion ? { advisorVersion: advisory.advisorVersion } : {}),
      ...(advisory.configVersion ? { advisorConfigVersion: advisory.configVersion } : {}),
      ...(advisory.outputHash ? { outputHash: advisory.outputHash } : {}),
      ...(advisory.validationError ? { validationError: advisory.validationError } : {}),
    };
    this.store.saveDecision(d);
    this.addAudit(caseId, e, 'DECISION_RECORDED', {
      selected,
      eligible: result.eligible,
      selectionSource: advisory.source,
      validationError: advisory.validationError ?? null,
    });
    if (isContact(selected) || selected === 'ESCALATE_TO_MERCHANT') {
      const key = `${caseId}:${e.eventId}:${selected}`;
      this.delivery.enqueue({
        id: `out_${hash(key)}`,
        key,
        caseId,
        action: selected,
        payload: { simulated: true, message: preview(selected) },
      });
      if (isContact(selected)) {
        c = { ...c, contactCount: c.contactCount + 1, lastContactAt: now };
        this.store.saveCase(c);
      }
      this.addAudit(caseId, e, 'OUTBOX_ENQUEUED', { selected });
    }
    const status: Outcome['status'] =
      c.state === 'RECOVERED'
        ? 'RECOVERED'
        : c.state === 'CLOSED_CANCELLED'
          ? 'CANCELLED'
          : selected === 'SUPPRESS'
            ? 'SUPPRESSED'
            : 'OPEN';
    const o: Outcome = {
      id: `outcome_${hash(e.eventId)}`,
      caseId,
      eventId: e.eventId,
      status,
      occurredAt: now,
      attribution: status === 'RECOVERED' ? 'platform_or_spontaneous' : 'none',
      ...(status === 'RECOVERED' ? { recoveredAmountMinor: e.amountMinor } : {}),
    };
    this.store.outcome(o);
    this.addAudit(caseId, e, 'OUTCOME_RECORDED', { status });
    this.telemetry.record('event.processed', {
      eventId: e.eventId,
      caseId,
      selectedAction: selected,
    });
    return this.existingView(caseId);
  }
  private subState(e: RecoveryEvent) {
    return (
      {
        'subscription.pending': 'pending',
        'subscription.charged': 'active',
        'subscription.halted': 'halted',
        'subscription.cancelled': 'cancelled',
        'subscription.paused': 'paused',
        'subscription.resumed': 'active',
        invalid: 'unknown',
      } as const
    )[e.type];
  }
  private caseState(e: RecoveryEvent, s: string, contradictory: boolean): CaseState {
    if (e.type === 'invalid' || e.identityConsistent === false || contradictory) return 'AMBIGUOUS';
    return s === 'pending'
      ? 'OPEN_PENDING'
      : s === 'halted'
        ? 'OPEN_HALTED'
        : s === 'active'
          ? 'RECOVERED'
          : s === 'cancelled'
            ? 'CLOSED_CANCELLED'
            : e.suppressed
              ? 'SUPPRESSED'
              : 'AMBIGUOUS';
  }
  private addAudit(
    caseId: string,
    e: RecoveryEvent,
    kind: AuditEvent['kind'],
    detail: Record<string, unknown>,
  ) {
    this.store.audit({
      id: `aud_${hash(`${e.eventId}:${kind}:${JSON.stringify(detail)}`)}`,
      caseId,
      eventId: e.eventId,
      at: e.receivedAt,
      kind,
      detail,
    });
  }
  private existingView(caseId: string): ExistingCaseView {
    const view = this.store.view(caseId);
    if (!view.case || !view.decisions[0]) throw new Error('processed case invariant failed');
    return view as ExistingCaseView;
  }
}
