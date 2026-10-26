import type { ErrorCode } from './error-codes.js';

export type ErrorDetails = Record<string, unknown>;

/**
 * Expected, client-facing error. The global error handler serializes it as
 * `{ error: { code, message, details } }`.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetails,
    /** Extra response headers, e.g. Retry-After on 429. */
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
