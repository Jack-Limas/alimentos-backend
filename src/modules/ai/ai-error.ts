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
  // The AI service itself refused the call (no Gemini involved). Each one points to a
  // different fix, so they are never folded into UPSTREAM_ERROR:
  /** 401/403: AI_INTERNAL_KEY differs between the backend and alimentos-ai. */
  'AUTH_REJECTED',
  /** 404: AI_SERVICE_URL points to the wrong path (e.g. it already ends in /v1). */
  'ENDPOINT_NOT_FOUND',
  /** 400/413/422: alimentos-ai rejected the context the backend built. */
  'INVALID_REQUEST',
  /** 429 from alimentos-ai's own limit (not Gemini's quota). */
  'RATE_LIMITED',
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
    /** Seconds until the AI may be called again (QUOTA_EXCEEDED, RATE_LIMITED). */
    public readonly retryAfterSec?: number,
    /**
     * What alimentos-ai answered, e.g. "HTTP 401 UNAUTHORIZED": status and code only,
     * never the key, the prompt or the model text.
     */
    public readonly upstream?: string,
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
        ...(this.upstream === undefined ? {} : { upstream: this.upstream }),
        ...(this.retryAfterSec === undefined ? {} : { retryAfterSec: this.retryAfterSec }),
      },
      this.retryAfterSec === undefined ? undefined : { 'Retry-After': String(this.retryAfterSec) },
    );
  }
}
