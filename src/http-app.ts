import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import type { RevenueRecoveryApplication } from './application.ts';
import { AppError, toHttpError } from './errors.ts';
import { evaluate } from './evaluation.ts';
import type { MerchantRole } from './experience.ts';
import { readiness, type ReadinessConfig } from './readiness.ts';
import { ACTIONS, type Action } from './types.ts';

export type AccessConfig = {
  /** Refuse every merchant control (for a public demo). */
  readOnly?: boolean;
  /** Shared secret required as `Authorization: Bearer <token>`. Not per-user auth. */
  adminToken?: string | undefined;
  /** Production: case data and receipts need the token; controls need it to exist. */
  protectData?: boolean;
};

export type HttpAppOptions = {
  application: RevenueRecoveryApplication;
  publicDir: string;
  readinessConfig?: ReadinessConfig;
  access?: AccessConfig;
};

const staticTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body, null, 2));
}

function serveStatic(res: ServerResponse, pathname: string, publicDir: string) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html', 'app.css', 'app.js', 'mark.svg'].includes(file)) return false;
  try {
    const body = readFileSync(join(publicDir, file));
    res.statusCode = 200;
    res.setHeader('content-type', staticTypes[extname(file)] ?? 'application/octet-stream');
    res.setHeader('cache-control', file === 'index.html' ? 'no-cache' : 'public, max-age=3600');
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

async function rawBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > 1_000_000) throw new AppError('PAYLOAD_TOO_LARGE', 'payload too large');
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const header = (req: IncomingMessage, name: string) => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

function hasAdminToken(req: IncomingMessage, token: string | undefined) {
  const supplied = header(req, 'authorization');
  if (!token || !supplied?.startsWith('Bearer ')) return false;
  const a = Buffer.from(supplied.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Write rules, in order: read-only refuses every write; a configured ADMIN_TOKEN
 * must be presented as a Bearer token; with no token, writes are allowed only
 * where the data is synthetic (demo/development), never in production.
 * The X-Merchant-Role header then only picks operator vs admin permissions.
 */
function checkWrite(req: IncomingMessage, access: AccessConfig) {
  if (access.readOnly) throw new AppError('FORBIDDEN', 'read-only deployment');
  if (access.adminToken) {
    if (!hasAdminToken(req, access.adminToken))
      throw new AppError('UNAUTHORIZED', 'admin token required');
  } else if (access.protectData) {
    throw new AppError('FORBIDDEN', 'set ADMIN_TOKEN to enable controls');
  }
}

/** In production, case data and receipts require the admin token. */
function checkRead(req: IncomingMessage, access: AccessConfig) {
  if (access.protectData && !hasAdminToken(req, access.adminToken))
    throw new AppError('UNAUTHORIZED', 'admin token required');
}

export function createHttpApp(options: HttpAppOptions) {
  const { application } = options;
  const access = options.access ?? {};
  return createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && serveStatic(res, pathname, options.publicDir)) return;
      if (req.method === 'POST' && pathname === '/webhooks/razorpay') {
        const result = application.webhook.process(await rawBody(req), {
          'x-razorpay-event-id': header(req, 'x-razorpay-event-id'),
          'x-razorpay-signature': header(req, 'x-razorpay-signature'),
        });
        // 401: bad signature. 500: processing rolled back, so Razorpay should retry.
        // Every other verified delivery is acknowledged with 2xx, even when it is
        // unsupported or needs reconciliation: retrying would not change the result,
        // and repeated non-2xx responses can get the webhook disabled.
        json(
          res,
          result.processingStatus === 'REJECTED'
            ? 401
            : result.processingStatus === 'FAILED'
              ? 500
              : ['PROCESSED', 'DUPLICATE'].includes(result.processingStatus)
                ? 202
                : 200,
          result,
        );
        return;
      }
      const control = pathname.match(/^\/cases\/([^/]+)\/(suppress|override)$/);
      if (req.method === 'POST' && control) {
        checkWrite(req, access);
        const caseId = decodeURIComponent(control[1]!);
        const role = header(req, 'x-merchant-role') as MerchantRole;
        if (control[2] === 'suppress') {
          json(res, 200, application.experience.suppress(caseId, role));
          return;
        }
        const body = JSON.parse((await rawBody(req)).toString('utf8')) as {
          action?: string;
        } | null;
        if (!ACTIONS.includes(body?.action as Action))
          throw new AppError('BAD_REQUEST', 'invalid action');
        json(res, 200, application.experience.override(caseId, body!.action as Action, role));
        return;
      }
      const delivery = pathname.match(/^\/outbox\/([^/]+)\/deliver$/);
      if (req.method === 'POST' && delivery) {
        checkWrite(req, access);
        json(
          res,
          200,
          application.experience.markDelivered(
            decodeURIComponent(delivery[1]!),
            header(req, 'x-merchant-role') as MerchantRole,
          ),
        );
        return;
      }
      if (pathname === '/health') {
        json(res, 200, readiness(options.readinessConfig ?? {}));
        return;
      }
      if (pathname === '/evaluation') {
        json(res, 200, evaluate());
        return;
      }
      if (pathname === '/webhook-receipts') {
        checkRead(req, access);
        json(res, 200, application.repository.webhookReceipts());
        return;
      }
      if (pathname === '/cases') {
        checkRead(req, access);
        json(res, 200, application.experience.queue());
        return;
      }
      if (pathname.startsWith('/cases/')) {
        checkRead(req, access);
        const view = application.repository.view(decodeURIComponent(pathname.slice(7)));
        json(res, view.case ? 200 : 404, view);
        return;
      }
      throw new AppError('NOT_FOUND', 'route not found');
    } catch (error) {
      const mapped = toHttpError(error);
      json(res, mapped.status, mapped.body);
    }
  });
}
