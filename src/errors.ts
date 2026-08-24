export const ERROR_CODES = [
  'BAD_REQUEST',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'CONFIG_INVALID',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: ReadonlyArray<string> | undefined;
  constructor(code: ErrorCode, message: string, details?: ReadonlyArray<string>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

const mapping: Record<ErrorCode, { status: number; message: string }> = {
  BAD_REQUEST: { status: 400, message: 'The request is invalid.' },
  FORBIDDEN: { status: 403, message: 'The operation is not permitted.' },
  NOT_FOUND: { status: 404, message: 'The requested resource was not found.' },
  CONFLICT: { status: 409, message: 'The operation conflicts with current state.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'The request payload is too large.' },
  CONFIG_INVALID: { status: 500, message: 'Runtime configuration is invalid.' },
  INTERNAL_ERROR: { status: 500, message: 'An internal error occurred.' },
};

export function toHttpError(error: unknown) {
  const appError =
    error instanceof AppError
      ? error
      : error instanceof SyntaxError
        ? new AppError('BAD_REQUEST', 'invalid syntax')
        : new AppError('INTERNAL_ERROR', 'internal');
  const safe = mapping[appError.code];
  return {
    status: safe.status,
    body: { error: appError.code, code: appError.code, message: safe.message },
  };
}
