import { describe, expect, it } from 'vitest';
import { createAiClient, DEFAULT_QUOTA_COOLDOWN_SEC } from '../src/modules/ai/ai-client.js';
import type { BriefingInput } from '../src/modules/ai/ai-context.js';
import { AiError } from '../src/modules/ai/ai-error.js';

const KEY = 'internal-key-for-tests-0123456789abcdef';
const input: BriefingInput = {
  locale: 'es',
  role: 'ADMIN',
  alerts: [],
  pendingOrders: [],
  kpis: {},
};
const meta = {
  model: 'gemini-test',
  promptVersion: 'briefing@2',
  latencyMs: 120,
  attempts: 1,
  discardedItems: 0,
};
const okBody = { summary: 'Todo en orden.', topActions: ['Revisa PED-000001'], meta };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const aiFailure = (
  status: number,
  category: string,
  extra: Record<string, unknown> = {},
  headers = {},
) => json(status, { error: { code: category, category, message: 'x', ...extra } }, headers);

/** A fake fetch that answers from a script and records every call. */
function scripted(...answers: (Response | Error | 'hang')[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer?.clone() as Response);
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const client = (fetch: typeof globalThis.fetch, now = () => 0) =>
  createAiClient({ baseUrl: 'http://ai.local:4100/', internalKey: KEY, timeoutMs: 30, fetch, now });

async function categoryOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AiError);
  return error as AiError;
}

describe('createAiClient', () => {
  it('sends the internal key and only the input, and validates the answer', async () => {
    const { fetch, calls } = scripted(json(200, okBody));

    const answer = await client(fetch).briefing(input);

    expect(answer).toEqual({
      data: { summary: 'Todo en orden.', topActions: ['Revisa PED-000001'] },
      meta,
    });
    expect(calls[0]?.url).toBe('http://ai.local:4100/v1/briefing');
    expect(new Headers(calls[0]?.init.headers).get('x-internal-key')).toBe(KEY);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(input);
  });

  it('is "not configured" without URL or key and never calls fetch', async () => {
    const { fetch, calls } = scripted(json(200, okBody));
    const ai = createAiClient({ baseUrl: undefined, internalKey: KEY, fetch });

    expect(ai.configured).toBe(false);
    expect((await categoryOf(ai.briefing(input))).category).toBe('NOT_CONFIGURED');
    expect(calls).toHaveLength(0);
  });

  it('retries once after UPSTREAM_ERROR and succeeds', async () => {
    const { fetch, calls } = scripted(aiFailure(502, 'UPSTREAM_ERROR'), json(200, okBody));

    await expect(client(fetch).briefing(input)).resolves.toMatchObject({
      data: { summary: 'Todo en orden.' },
    });
    expect(calls).toHaveLength(2);
  });

  it('retries once after a network error, then gives up with UPSTREAM_ERROR', async () => {
    const { fetch, calls } = scripted(new TypeError('fetch failed'));

    expect((await categoryOf(client(fetch).briefing(input))).category).toBe('UPSTREAM_ERROR');
    expect(calls).toHaveLength(2);
  });

  it('times out each attempt with AbortController and retries once', async () => {
    const { fetch, calls } = scripted('hang');

    expect((await categoryOf(client(fetch).briefing(input))).category).toBe('TIMEOUT');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.init.signal?.aborted).toBe(true);
  });

  it.each(['INVALID_API_KEY', 'MODEL_NOT_FOUND'])('does not retry %s', async (category) => {
    const { fetch, calls } = scripted(aiFailure(502, category));

    expect((await categoryOf(client(fetch).briefing(input))).category).toBe(category);
    expect(calls).toHaveLength(1);
  });

  it('does not retry a rejected internal key or a 400', async () => {
    for (const failure of [
      json(401, { error: { code: 'UNAUTHORIZED' } }),
      json(400, { error: { code: 'VALIDATION_ERROR' } }),
    ]) {
      const { fetch, calls } = scripted(failure);
      expect((await categoryOf(client(fetch).briefing(input))).category).toBe('UPSTREAM_ERROR');
      expect(calls).toHaveLength(1);
    }
  });

  it('treats an answer that does not match the schema as UPSTREAM_ERROR', async () => {
    const { fetch, calls } = scripted(json(200, { summary: '', topActions: 'nope', meta }));

    expect((await categoryOf(client(fetch).briefing(input))).category).toBe('UPSTREAM_ERROR');
    expect(calls).toHaveLength(2);
  });

  it('cools down after QUOTA_EXCEEDED until Retry-After, without calling', async () => {
    let now = 1_000_000;
    const { fetch, calls } = scripted(
      aiFailure(429, 'QUOTA_EXCEEDED', {}, { 'retry-after': '30' }),
      json(200, okBody),
    );
    const ai = client(fetch, () => now);

    const first = await categoryOf(ai.briefing(input));
    expect(first).toMatchObject({ category: 'QUOTA_EXCEEDED', retryAfterSec: 30 });

    now += 10_000;
    const blocked = await categoryOf(
      ai.rescuePlan({ locale: 'es', products: [], customerTypes: [] }),
    );
    expect(blocked).toMatchObject({ category: 'QUOTA_EXCEEDED', retryAfterSec: 20 });
    expect(calls).toHaveLength(1);

    now += 20_000;
    await expect(ai.briefing(input)).resolves.toMatchObject({ meta: { model: 'gemini-test' } });
    expect(calls).toHaveLength(2);
  });

  it('cools down for 60 s when QUOTA_EXCEEDED has no Retry-After', async () => {
    let now = 0;
    const { fetch, calls } = scripted(aiFailure(429, 'QUOTA_EXCEEDED'), json(200, okBody));
    const ai = client(fetch, () => now);

    expect((await categoryOf(ai.briefing(input))).retryAfterSec).toBe(DEFAULT_QUOTA_COOLDOWN_SEC);
    now += 59_000;
    await categoryOf(ai.briefing(input));
    expect(calls).toHaveLength(1);
    now += 1_000;
    await ai.briefing(input);
    expect(calls).toHaveLength(2);
  });

  it('maps an AI error to 503 AI_UNAVAILABLE with details.category', () => {
    const error = new AiError('QUOTA_EXCEEDED', 12).toAppError();

    expect(error).toMatchObject({
      statusCode: 503,
      code: 'AI_UNAVAILABLE',
      details: { category: 'QUOTA_EXCEEDED', retryAfterSec: 12 },
      headers: { 'Retry-After': '12' },
    });
  });
});
