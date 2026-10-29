import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  degradedDetail,
  exitCodeOf,
  renderResults,
  runSmoke,
  warmUp,
  type CheckResult,
} from '../scripts/smoke/smoke.js';
import { ADMIN, OPERATOR, buildAuthTestApp } from './helpers/auth-fixtures.js';
import { ALLOWED_ORIGIN, dbDown } from './helpers/test-app.js';

const BASE = 'https://api.example.test';

const urlOf = (input: string | URL | Request) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** fetch over app.inject: the smoke script talks to the real app in memory. */
function injectFetch(app: FastifyInstance): typeof fetch {
  return async (input, init) => {
    const url = new URL(urlOf(input));
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET',
      url: url.pathname + url.search,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(res.headers)) {
      for (const one of Array.isArray(value) ? value : [value]) {
        if (one !== undefined) headers.append(name, String(one));
      }
    }
    const empty = res.statusCode === 204 || res.statusCode === 304;
    return new Response(empty ? null : res.rawPayload, { status: res.statusCode, headers });
  };
}

async function smoke(overrides: Parameters<typeof buildAuthTestApp>[0] = {}) {
  const { app } = await buildAuthTestApp(overrides);
  const results = await runSmoke({
    baseUrl: BASE,
    frontendOrigin: ALLOWED_ORIGIN,
    admin: ADMIN,
    operator: OPERATOR,
    fetch: injectFetch(app),
  });
  await app.close();
  return results;
}

const byName = (results: CheckResult[], name: string) =>
  results.find((r) => r.name === name)?.outcome;

describe('smoke:prod', { timeout: 60_000 }, () => {
  it('passes against a healthy API, with a warning for the empty impact', async () => {
    const results = await smoke();

    expect(results.filter((r) => r.outcome === 'FAIL')).toEqual([]);
    expect(exitCodeOf(results)).toBe(0);
    expect(results.map((r) => r.name)).toEqual([
      'GET /health',
      'GET /api/v1/health/ready (database)',
      'POST /auth/login (ADMIN)',
      'POST /auth/login (OPERATOR)',
      'GET /auth/me',
      'GET /products',
      'GET /alerts',
      'GET /orders',
      'GET /distribution/snapshot',
      'POST /distribution/proposals (BALANCED)',
      'POST /proposals/:id/discard (BALANCED)',
      'POST /distribution/proposals (AI_ASSISTED)',
      'POST /proposals/:id/discard (AI_ASSISTED)',
      'GET /reports/inventory (CSV)',
      'GET /metrics/api',
      'GET /public/impact',
      'OPERATOR → GET /reports/inventory is 403',
      'anonymous → GET /products is 401',
      `CORS preflight from ${ALLOWED_ORIGIN}`,
      'POST /auth/logout (ADMIN)',
      'POST /auth/logout (OPERATOR)',
    ]);
    expect(byName(results, 'GET /public/impact')).toBe('WARN');
  });

  it('reports a degraded AI_ASSISTED proposal as a warning, not a failure', async () => {
    const { app } = await buildAuthTestApp();
    const real = injectFetch(app);
    const results = await runSmoke({
      baseUrl: BASE,
      frontendOrigin: ALLOWED_ORIGIN,
      admin: ADMIN,
      operator: OPERATOR,
      // The AI service is down: the API answers the BALANCED plan marked as degraded.
      fetch: (input, init) =>
        urlOf(input).endsWith('/distribution/proposals') &&
        typeof init?.body === 'string' &&
        init.body.includes('AI_ASSISTED')
          ? Promise.resolve(
              Response.json(
                {
                  data: {
                    id: 'p-1',
                    degraded: true,
                    summary: { aiError: 'AUTH_REJECTED', aiErrorDetail: 'HTTP 401 UNAUTHORIZED' },
                  },
                },
                { status: 201 },
              ),
            )
          : real(input, init),
    });
    await app.close();

    const ai = results.find((r) => r.name === 'POST /distribution/proposals (AI_ASSISTED)');
    expect(ai).toMatchObject({
      outcome: 'WARN',
      detail:
        'degraded to BALANCED: AUTH_REJECTED (HTTP 401 UNAUTHORIZED) → AI_INTERNAL_KEY differs between the backend and alimentos-ai',
    });
  });

  it('fails (exit 1) when the database is down, and keeps going with the other checks', async () => {
    const results = await smoke({ checkDatabase: dbDown });

    expect(byName(results, 'GET /api/v1/health/ready (database)')).toBe('FAIL');
    expect(byName(results, 'GET /health')).toBe('PASS');
    expect(exitCodeOf(results)).toBe(1);
  });

  it('fails the CORS check for a frontend origin the API does not allow', async () => {
    const { app } = await buildAuthTestApp();
    const results = await runSmoke({
      baseUrl: BASE,
      frontendOrigin: 'https://not-the-frontend.example',
      admin: ADMIN,
      operator: OPERATOR,
      fetch: injectFetch(app),
    });
    await app.close();
    expect(byName(results, 'CORS preflight from https://not-the-frontend.example')).toBe('FAIL');
  });

  it('never prints the passwords or the tokens', async () => {
    const table = renderResults(await smoke());

    expect(table).toMatch(/PASS \d+ · WARN \d+ · FAIL 0/);
    expect(table).not.toContain(ADMIN.password);
    expect(table).not.toContain(OPERATOR.password);
    expect(table).not.toMatch(/eyJ[\w-]+\./);
    expect(table).not.toContain('refresh_token=');
  });
});

describe('smoke:prod --warm', () => {
  it('pings each service until it answers 200 and fails the ones that never do', async () => {
    let clock = 0;
    const answers: Record<string, number[]> = {
      'https://api.example.test/health': [503, 503, 200],
      'https://web.example.test/es': [200],
      'https://ai.example.test/health': [],
    };
    const results = await warmUp(
      [
        { name: 'backend', url: 'https://api.example.test/health' },
        { name: 'frontend', url: 'https://web.example.test/es' },
        { name: 'ai', url: 'https://ai.example.test/health' },
      ],
      {
        fetch: (input) => {
          const status = answers[urlOf(input)]?.shift();
          return status === undefined
            ? Promise.reject(new TypeError('fetch failed'))
            : Promise.resolve(new Response(null, { status }));
        },
        sleep: (ms) => {
          clock += ms;
          return Promise.resolve();
        },
        now: () => clock,
        intervalMs: 5_000,
        deadlineMs: 60_000,
      },
    );

    expect(results.map((r) => [r.name, r.outcome])).toEqual([
      ['backend', 'PASS'],
      ['frontend', 'PASS'],
      ['ai', 'FAIL'],
    ]);
    expect(results[0]?.detail).toBe('HTTP 200 after 3 attempts');
    expect(exitCodeOf(results)).toBe(1);
  });
});

describe('smoke:prod AI detail', () => {
  it('shows the category, what alimentos-ai answered and what to check', () => {
    expect(
      degradedDetail({ aiError: 'ENDPOINT_NOT_FOUND', aiErrorDetail: 'HTTP 404 NOT_FOUND' }),
    ).toBe(
      'degraded to BALANCED: ENDPOINT_NOT_FOUND (HTTP 404 NOT_FOUND) → AI_SERVICE_URL must be the AI origin, without /v1',
    );
    expect(degradedDetail({ aiError: 'TIMEOUT' })).toBe(
      'degraded to BALANCED: TIMEOUT → the AI did not answer in time (cold start?)',
    );
    expect(degradedDetail(undefined)).toBe('degraded to BALANCED: AI unavailable');
  });
});
