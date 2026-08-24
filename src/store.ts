import { DatabaseSync } from 'node:sqlite';
import type { CaseView, OutboxItem, RecoveryRepository, WebhookReceipt } from './ports.ts';
import type { AuditEvent, Decision, Outcome, RecoveryCase, RecoveryEvent } from './types.ts';
export class Store implements RecoveryRepository {
  readonly db: DatabaseSync;
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS webhook_receipts(seq INTEGER PRIMARY KEY AUTOINCREMENT,receipt_id TEXT UNIQUE NOT NULL,event_id TEXT NOT NULL,received_at TEXT NOT NULL,verification TEXT NOT NULL,processing_status TEXT NOT NULL,redacted_payload TEXT NOT NULL,error TEXT); CREATE TABLE IF NOT EXISTS inbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,received_at TEXT NOT NULL,payload TEXT NOT NULL,duplicate INTEGER NOT NULL DEFAULT 0); CREATE UNIQUE INDEX IF NOT EXISTS one_original ON inbox(event_id) WHERE duplicate=0; CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY,event_id TEXT UNIQUE NOT NULL,case_id TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,case_id TEXT NOT NULL,event_id TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,dispatch_key TEXT UNIQUE NOT NULL,case_id TEXT NOT NULL,action TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS outcomes(id TEXT PRIMARY KEY,event_id TEXT UNIQUE NOT NULL,case_id TEXT NOT NULL,data TEXT NOT NULL);`,
    );
  }
  ingest(e: RecoveryEvent) {
    try {
      this.db
        .prepare('INSERT INTO inbox(event_id,received_at,payload) VALUES(?,?,?)')
        .run(e.eventId, e.receivedAt, JSON.stringify(e));
      return true;
    } catch {
      this.db
        .prepare('INSERT INTO inbox(event_id,received_at,payload,duplicate) VALUES(?,?,?,1)')
        .run(e.eventId, e.receivedAt, JSON.stringify(e));
      return false;
    }
  }
  getCase(id: string) {
    const r = this.db.prepare('SELECT data FROM cases WHERE id=?').get(id) as
      { data: string } | undefined;
    return r ? (JSON.parse(r.data) as RecoveryCase) : undefined;
  }
  listCases() {
    return (
      this.db.prepare("SELECT data FROM cases ORDER BY json_extract(data,'$.state'),id").all() as {
        data: string;
      }[]
    ).map((row) => JSON.parse(row.data) as RecoveryCase);
  }
  saveCase(c: RecoveryCase) {
    this.db
      .prepare('INSERT INTO cases VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(c.id, JSON.stringify(c));
  }
  saveDecision(d: Decision) {
    this.db
      .prepare('INSERT OR IGNORE INTO decisions VALUES(?,?,?,?)')
      .run(d.id, d.eventId, d.caseId, JSON.stringify(d));
  }
  audit(a: AuditEvent) {
    this.db
      .prepare('INSERT OR IGNORE INTO audit(id,case_id,event_id,data) VALUES(?,?,?,?)')
      .run(a.id, a.caseId, a.eventId, JSON.stringify(a));
  }
  enqueue(id: string, key: string, caseId: string, action: string, payload: unknown) {
    this.db
      .prepare('INSERT OR IGNORE INTO outbox VALUES(?,?,?,?,?,?)')
      .run(id, key, caseId, action, 'SIMULATED', JSON.stringify(payload));
  }
  outboxItem(id: string) {
    return this.db
      .prepare('SELECT id,case_id,action,status,payload FROM outbox WHERE id=?')
      .get(id) as
      { id: string; case_id: string; action: string; status: string; payload: string } | undefined;
  }
  markOutboxDelivered(id: string) {
    this.db
      .prepare("UPDATE outbox SET status='SIMULATED_DELIVERED' WHERE id=? AND status='SIMULATED'")
      .run(id);
  }
  outcome(o: Outcome) {
    this.db
      .prepare('INSERT OR IGNORE INTO outcomes VALUES(?,?,?,?)')
      .run(o.id, o.eventId, o.caseId, JSON.stringify(o));
  }
  recordWebhookReceipt(r: {
    receiptId: string;
    eventId: string;
    receivedAt: string;
    verification: string;
    processingStatus: string;
    redactedPayload: unknown;
  }) {
    this.db
      .prepare(
        'INSERT INTO webhook_receipts(receipt_id,event_id,received_at,verification,processing_status,redacted_payload) VALUES(?,?,?,?,?,?)',
      )
      .run(
        r.receiptId,
        r.eventId,
        r.receivedAt,
        r.verification,
        r.processingStatus,
        JSON.stringify(r.redactedPayload),
      );
  }
  updateWebhookReceipt(id: string, status: string, error?: string) {
    this.db
      .prepare('UPDATE webhook_receipts SET processing_status=?,error=? WHERE receipt_id=?')
      .run(status, error ?? null, id);
  }
  webhookReceipts() {
    return this.db
      .prepare(
        'SELECT receipt_id,event_id,received_at,verification,processing_status,redacted_payload,error FROM webhook_receipts ORDER BY seq',
      )
      .all() as WebhookReceipt[];
  }
  isDuplicateReceipt(eventId: string) {
    return (
      Number(
        (
          this.db.prepare('SELECT count(*) n FROM inbox WHERE event_id=?').get(eventId) as {
            n: number;
          }
        ).n,
      ) > 1
    );
  }
  view(caseId: string): CaseView {
    const c = this.getCase(caseId);
    const decisions = (
      this.db.prepare('SELECT data FROM decisions WHERE case_id=? ORDER BY rowid').all(caseId) as {
        data: string;
      }[]
    ).map((x) => JSON.parse(x.data) as Decision);
    const audit = (
      this.db.prepare('SELECT data FROM audit WHERE case_id=? ORDER BY seq').all(caseId) as {
        data: string;
      }[]
    ).map((x) => JSON.parse(x.data) as AuditEvent);
    const outbox = this.db
      .prepare(
        'SELECT id,dispatch_key,case_id,action,status,payload FROM outbox WHERE case_id=? ORDER BY rowid',
      )
      .all(caseId) as Array<OutboxItem & { dispatch_key: string }>;
    const outcomes = (
      this.db.prepare('SELECT data FROM outcomes WHERE case_id=? ORDER BY rowid').all(caseId) as {
        data: string;
      }[]
    ).map((x) => JSON.parse(x.data) as Outcome);
    return { case: c, decisions, audit, outbox, outcomes };
  }
  counts() {
    return {
      inbox: Number((this.db.prepare('SELECT count(*) n FROM inbox').get() as { n: number }).n),
      outbox: Number((this.db.prepare('SELECT count(*) n FROM outbox').get() as { n: number }).n),
    };
  }
  close() {
    this.db.close();
  }
}
