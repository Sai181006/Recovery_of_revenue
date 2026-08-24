import type { Advisor } from './advisor.ts';
import type { AuditEvent, Decision, Outcome, RecoveryCase, RecoveryEvent } from './types.ts';

export type OutboxItem = {
  id: string;
  case_id: string;
  action: string;
  status: string;
  payload: string;
};

export type CaseView = {
  case: RecoveryCase | undefined;
  decisions: Decision[];
  audit: AuditEvent[];
  outbox: Array<OutboxItem & { dispatch_key?: string }>;
  outcomes: Outcome[];
};

export type ExistingCaseView = Omit<CaseView, 'case' | 'decisions'> & {
  case: RecoveryCase;
  decisions: [Decision, ...Decision[]];
};

export type WebhookReceipt = {
  receipt_id: string;
  event_id: string;
  received_at: string;
  verification: string;
  processing_status: string;
  redacted_payload: string;
  error: string | null;
};

export interface RecoveryRepository {
  ingest(event: RecoveryEvent): boolean;
  getCase(id: string): RecoveryCase | undefined;
  listCases(): RecoveryCase[];
  saveCase(recoveryCase: RecoveryCase): void;
  saveDecision(decision: Decision): void;
  audit(event: AuditEvent): void;
  enqueue(id: string, key: string, caseId: string, action: string, payload: unknown): void;
  outboxItem(id: string): OutboxItem | undefined;
  markOutboxDelivered(id: string): void;
  outcome(outcome: Outcome): void;
  recordWebhookReceipt(receipt: {
    receiptId: string;
    eventId: string;
    receivedAt: string;
    verification: string;
    processingStatus: string;
    redactedPayload: unknown;
  }): void;
  updateWebhookReceipt(id: string, status: string, error?: string): void;
  webhookReceipts(): WebhookReceipt[];
  isDuplicateReceipt(eventId: string): boolean;
  view(caseId: string): CaseView;
  counts(): { inbox: number; outbox: number };
  close(): void;
}

export interface Clock {
  now(): string;
}

export interface DeliveryExecutor {
  enqueue(request: {
    id: string;
    key: string;
    caseId: string;
    action: string;
    payload: unknown;
  }): void;
}

export interface Telemetry {
  record(name: string, detail: Record<string, unknown>): void;
}

export type ApplicationPorts = {
  repository: RecoveryRepository;
  clock: Clock;
  advisor?: Advisor;
  delivery?: DeliveryExecutor;
  telemetry?: Telemetry;
};

export const systemClock: Clock = { now: () => new Date().toISOString() };
export const noopTelemetry: Telemetry = { record: () => undefined };

export function repositoryDelivery(repository: RecoveryRepository): DeliveryExecutor {
  return {
    enqueue: ({ id, key, caseId, action, payload }) =>
      repository.enqueue(id, key, caseId, action, payload),
  };
}
