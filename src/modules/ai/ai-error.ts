import { AppError } from '../../shared/errors/index.js';

/**
 * Why the AI did not answer (contract 4.9 and 5). NOT_CONFIGURED means the
 * backend has no AI_SERVICE_URL / AI_INTERNAL_KEY: the rest keeps working.
 */
export const AI_ERROR_CATEGORIES = [
  'NOT_CONFIGURED',
  'TIMEOUT',
  'UPSTREAM_ERROR',
  'QUOTA_EXCEEDED',
  'INVALID_API_KEY',
  'MODEL_NOT_FOUND',
] as const;

export type AiErrorCategory = (typeof AI_ERROR_CATEGORIES)[number];

/** Worth a second attempt: the next call may succeed. */
export const RETRYABLE_CATEGORIES: ReadonlySet<AiErrorCategory> = new Set([
  'TIMEOUT',
  'UPSTREAM_ERROR',
]);

export function isAiErrorCategory(value: unknown): value is AiErrorCategory {
  return (AI_ERROR_CATEGORIES as readonly unknown[]).includes(value);
}

export class AiError extends Error {
  constructor(
    public readonly category: AiErrorCategory,
    /** Seconds until the AI may be called again (QUOTA_EXCEEDED). */
    public readonly retryAfterSec?: number,
  ) {
    super(`AI unavailable: ${category}`);
    this.name = 'AiError';
  }

  /** 503 AI_UNAVAILABLE with details.category; the UI shows the rules result. */
  toAppError(): AppError {
    return new AppError(
      503,
      'AI_UNAVAILABLE',
      'The AI service is not available',
      {
        category: this.category,
        ...(this.retryAfterSec === undefined ? {} : { retryAfterSec: this.retryAfterSec }),
      },
      this.retryAfterSec === undefined ? undefined : { 'Retry-After': String(this.retryAfterSec) },
    );
  }
}
