import type { CaseView, OutboxItem, RecoveryRepository, WebhookReceipt } from './ports.ts';
import type { AuditEvent, Decision, Outcome, RecoveryCase, RecoveryEvent } from './types.ts';

type StoredOutbox = OutboxItem & { dispatch_key: string };

export class MemoryStore implements RecoveryRepository {
  private readonly originals = new Set<string>();
  private readonly receiptCounts = new Map<string, number>();
  private inboxCount = 0;
  private readonly cases = new Map<string, RecoveryCase>();
  private readonly decisions = new Map<string, Decision>();
  private readonly audits = new Map<string, AuditEvent>();
  private readonly outbox = new Map<string, StoredOutbox>();
  private readonly outcomes = new Map<string, Outcome>();
  private readonly receipts: WebhookReceipt[] = [];
  private closed = false;

  ingest(event: RecoveryEvent) {
    this.assertOpen();
    this.inboxCount += 1;
    this.receiptCounts.set(event.eventId, (this.receiptCounts.get(event.eventId) ?? 0) + 1);
    if (this.originals.has(event.eventId)) return false;
    this.originals.add(event.eventId);
    return true;
  }

  getCase(id: string) {
    return this.cases.get(id);
  }

  listCases() {
    return [...this.cases.values()].sort(
      (a, b) => a.state.localeCompare(b.state) || a.id.localeCompare(b.id),
    );
  }

  saveCase(recoveryCase: RecoveryCase) {
    this.assertOpen();
    this.cases.set(recoveryCase.id, structuredClone(recoveryCase));
  }

  saveDecision(decision: Decision) {
    this.assertOpen();
    if (![...this.decisions.values()].some((item) => item.eventId === decision.eventId)) {
      this.decisions.set(decision.id, structuredClone(decision));
    }
  }

  audit(event: AuditEvent) {
    this.assertOpen();
    if (!this.audits.has(event.id)) this.audits.set(event.id, structuredClone(event));
  }

  enqueue(id: string, key: string, caseId: string, action: string, payload: unknown) {
    this.assertOpen();
    if ([...this.outbox.values()].some((item) => item.dispatch_key === key)) return;
    this.outbox.set(id, {
      id,
      dispatch_key: key,
      case_id: caseId,
      action,
      status: 'SIMULATED',
      payload: JSON.stringify(payload),
    });
  }

  outboxItem(id: string) {
    return this.outbox.get(id);
  }

  markOutboxDelivered(id: string) {
    const item = this.outbox.get(id);
    if (item?.status === 'SIMULATED') item.status = 'SIMULATED_DELIVERED';
  }

  outcome(outcome: Outcome) {
    this.assertOpen();
    if (![...this.outcomes.values()].some((item) => item.eventId === outcome.eventId)) {
      this.outcomes.set(outcome.id, structuredClone(outcome));
    }
  }

  recordWebhookReceipt(receipt: {
    receiptId: string;
    eventId: string;
    receivedAt: string;
    verification: string;
    processingStatus: string;
    redactedPayload: unknown;
  }) {
    this.assertOpen();
    this.receipts.push({
      receipt_id: receipt.receiptId,
      event_id: receipt.eventId,
      received_at: receipt.receivedAt,
      verification: receipt.verification,
      processing_status: receipt.processingStatus,
      redacted_payload: JSON.stringify(receipt.redactedPayload),
      error: null,
    });
  }

  updateWebhookReceipt(id: string, status: string, error?: string) {
    const receipt = this.receipts.find((item) => item.receipt_id === id);
    if (!receipt) return;
    receipt.processing_status = status;
    receipt.error = error ?? null;
  }

  webhookReceipts() {
    return structuredClone(this.receipts);
  }

  isDuplicateReceipt(eventId: string) {
    return (this.receiptCounts.get(eventId) ?? 0) > 1;
  }

  view(caseId: string): CaseView {
    return {
      case: this.getCase(caseId),
      decisions: [...this.decisions.values()].filter((item) => item.caseId === caseId),
      audit: [...this.audits.values()].filter((item) => item.caseId === caseId),
      outbox: [...this.outbox.values()].filter((item) => item.case_id === caseId),
      outcomes: [...this.outcomes.values()].filter((item) => item.caseId === caseId),
    };
  }

  counts() {
    return { inbox: this.inboxCount, outbox: this.outbox.size };
  }

  close() {
    this.closed = true;
  }

  private assertOpen() {
    if (this.closed) throw new Error('repository closed');
  }
}
