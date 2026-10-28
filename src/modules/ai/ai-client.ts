import type { z } from 'zod';
import { AiError, isAiErrorCategory, RETRYABLE_CATEGORIES } from './ai-error.js';
import {
  aiErrorBodySchema,
  aiMetaSchema,
  briefingSchema,
  proposalExplanationSchema,
  rescuePlanSchema,
  type AiServiceMeta,
  type Briefing,
  type ProposalExplanation,
  type RescuePlan,
} from './ai.schemas.js';
import type { BriefingInput, ProposalExplanationInput, RescuePlanInput } from './ai-context.js';

export const DEFAULT_AI_TIMEOUT_MS = 15_000;
/** Cool-down after QUOTA_EXCEEDED when the service sends no Retry-After. */
export const DEFAULT_QUOTA_COOLDOWN_SEC = 60;
/** One retry, and only for TIMEOUT, UPSTREAM_ERROR or a network error. */
export const MAX_ATTEMPTS = 2;

export interface AiAnswer<T> {
  data: T;
  meta: AiServiceMeta;
}

export interface AiClient {
  /** False without AI_SERVICE_URL / AI_INTERNAL_KEY: every call fails with NOT_CONFIGURED. */
  readonly configured: boolean;
  explainProposal(input: ProposalExplanationInput): Promise<AiAnswer<ProposalExplanation>>;
  rescuePlan(input: RescuePlanInput): Promise<AiAnswer<RescuePlan>>;
  briefing(input: BriefingInput): Promise<AiAnswer<Briefing>>;
}

export interface AiClientConfig {
  baseUrl?: string | undefined;
  internalKey?: string | undefined;
  timeoutMs?: number | undefined;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  /** Milliseconds clock for the quota cool-down. */
  now?: () => number;
}

/** A failed attempt and whether a second one may help. */
class AttemptError extends Error {
  constructor(
    public readonly error: AiError,
    public readonly retryable: boolean,
  ) {
    super(error.message);
  }
}

function retryAfterOf(header: string | null, bodySec: number | undefined): number | undefined {
  const seconds = header === null ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  return bodySec === undefined ? undefined : Math.ceil(bodySec);
}

async function failureOf(response: Response): Promise<AttemptError> {
  const parsed = aiErrorBodySchema.safeParse(await response.json().catch(() => null));
  const category = parsed.success
    ? (parsed.data.error.category ?? parsed.data.error.code)
    : undefined;
  if (isAiErrorCategory(category) && category !== 'NOT_CONFIGURED') {
    const retryAfter =
      category === 'QUOTA_EXCEEDED'
        ? retryAfterOf(
            response.headers.get('retry-after'),
            parsed.success ? parsed.data.error.retryAfterSec : undefined,
          )
        : undefined;
    return new AttemptError(new AiError(category, retryAfter), RETRYABLE_CATEGORIES.has(category));
  }
  // Wrong internal key, a 400 from the service or an unknown answer: only a 5xx may pass on retry.
  return new AttemptError(new AiError('UPSTREAM_ERROR'), response.status >= 500);
}

/** A client that never calls anything: the AI is simply "not configured". */
function notConfiguredClient(): AiClient {
  const fail = () => Promise.reject(new AiError('NOT_CONFIGURED'));
  return { configured: false, explainProposal: fail, rescuePlan: fail, briefing: fail };
}

/**
 * HTTP client of alimentos-ai (contract 5): X-Internal-Key, a timeout per
 * attempt, 1 retry only for TIMEOUT / UPSTREAM_ERROR / network errors, and an
 * in-memory cool-down after QUOTA_EXCEEDED (no call until Retry-After, or 60 s).
 * Answers are validated with Zod; anything unexpected is UPSTREAM_ERROR.
 */
export function createAiClient({
  baseUrl,
  internalKey,
  timeoutMs = DEFAULT_AI_TIMEOUT_MS,
  fetch: fetchImpl = fetch,
  now = Date.now,
}: AiClientConfig): AiClient {
  if (!baseUrl || !internalKey) return notConfiguredClient();
  const base = baseUrl.replace(/\/+$/, '');
  const key = internalKey;
  let blockedUntil = 0;

  async function attempt<T>(path: string, body: unknown, schema: z.ZodType<T>) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      const category = controller.signal.aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR';
      throw new AttemptError(new AiError(category), true);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw await failureOf(response);

    const json: unknown = await response.json().catch(() => null);
    const { meta, ...rest } = (typeof json === 'object' && json !== null ? json : {}) as {
      meta?: unknown;
    };
    const data = schema.safeParse(rest);
    const parsedMeta = aiMetaSchema.safeParse(meta);
    if (!data.success || !parsedMeta.success) {
      throw new AttemptError(new AiError('UPSTREAM_ERROR'), true);
    }
    return { data: data.data, meta: parsedMeta.data };
  }

  async function call<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<AiAnswer<T>> {
    const waitMs = blockedUntil - now();
    if (waitMs > 0) throw new AiError('QUOTA_EXCEEDED', Math.ceil(waitMs / 1000));

    for (let attemptNumber = 1; ; attemptNumber += 1) {
      try {
        return await attempt(path, body, schema);
      } catch (failure) {
        if (!(failure instanceof AttemptError)) throw failure;
        const { error } = failure;
        if (error.category === 'QUOTA_EXCEEDED') {
          const seconds = error.retryAfterSec ?? DEFAULT_QUOTA_COOLDOWN_SEC;
          blockedUntil = now() + seconds * 1000;
          throw new AiError('QUOTA_EXCEEDED', seconds);
        }
        if (!failure.retryable || attemptNumber >= MAX_ATTEMPTS) throw error;
      }
    }
  }

  return {
    configured: true,
    explainProposal: (input) => call('/v1/proposal-explanation', input, proposalExplanationSchema),
    rescuePlan: (input) => call('/v1/rescue-plan', input, rescuePlanSchema),
    briefing: (input) => call('/v1/briefing', input, briefingSchema),
  };
}
