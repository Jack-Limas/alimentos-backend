/**
 * Production smoke test of the deployed API (`npm run smoke:prod`). Pure
 * apart from `fetch`, so tests run it against the app in memory. Never prints
 * passwords or tokens: details are statuses, counts and timings only.
 */

export type Outcome = 'PASS' | 'WARN' | 'FAIL';

export interface CheckResult {
  name: string;
  outcome: Outcome;
  ms: number;
  detail: string;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface SmokeConfig {
  /** Backend origin, e.g. https://alimentos-backend.onrender.com */
  baseUrl: string;
  /** Frontend origin that must pass the CORS preflight. */
  frontendOrigin: string;
  admin: Credentials;
  operator: Credentials;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** A check failed in a way that should stop the dependent checks. */
class CheckFailure extends Error {}

interface Session {
  token: string;
  /** "refresh_token=…" to send back on logout. */
  cookie: string | null;
}

function cookieOf(response: Response): string | null {
  const all = response.headers.getSetCookie();
  const refresh = all.find((value) => value.startsWith('refresh_token='));
  return refresh ? (refresh.split(';')[0] ?? null) : null;
}

export async function runSmoke(config: SmokeConfig): Promise<CheckResult[]> {
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? (() => performance.now());
  const timeoutMs = config.timeoutMs ?? 60_000;
  const results: CheckResult[] = [];
  const api = (path: string) => `${config.baseUrl}/api/v1${path}`;

  const request = (
    url: string,
    init: RequestInit & { token?: string; json?: unknown } = {},
  ): Promise<Response> => {
    const { token, json, headers, ...rest } = init;
    const all = new Headers(headers);
    if (token) all.set('authorization', `Bearer ${token}`);
    if (json !== undefined) all.set('content-type', 'application/json');
    return doFetch(url, {
      ...rest,
      headers: all,
      signal: AbortSignal.timeout(timeoutMs),
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  };

  /** Runs one check; a thrown CheckFailure or error is a FAIL with its message. */
  async function check<T>(
    name: string,
    run: () => Promise<{ outcome?: Outcome; detail: string; value?: T }>,
  ): Promise<T | undefined> {
    const started = now();
    try {
      const { outcome = 'PASS', detail, value } = await run();
      results.push({ name, outcome, ms: Math.round(now() - started), detail });
      return value;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({ name, outcome: 'FAIL', ms: Math.round(now() - started), detail });
      return undefined;
    }
  }

  const expect = (response: Response, status: number) => {
    if (response.status !== status) {
      throw new CheckFailure(`HTTP ${String(response.status)} (expected ${String(status)})`);
    }
  };

  await check('GET /health', async () => {
    const res = await request(`${config.baseUrl}/health`);
    expect(res, 200);
    return { detail: 'HTTP 200' };
  });
  await check('GET /api/v1/health/ready (database)', async () => {
    const res = await request(api('/health/ready'));
    expect(res, 200);
    return { detail: 'HTTP 200, database up' };
  });

  const login = (who: string, credentials: Credentials) =>
    check<Session>(`POST /auth/login (${who})`, async () => {
      const res = await request(api('/auth/login'), { method: 'POST', json: credentials });
      expect(res, 200);
      const body = (await res.json()) as { accessToken?: string; user?: { role?: string } };
      if (!body.accessToken) throw new CheckFailure('no access token in the answer');
      if (body.user?.role !== who) throw new CheckFailure(`role ${String(body.user?.role)}`);
      const cookie = cookieOf(res);
      return {
        ...(cookie ? {} : { outcome: 'WARN' as const }),
        detail: cookie ? `role ${who}, refresh cookie set` : `role ${who}, no refresh cookie seen`,
        value: { token: body.accessToken, cookie },
      };
    });
  const admin = await login('ADMIN', config.admin);
  const operator = await login('OPERATOR', config.operator);

  if (admin) {
    const get = (name: string, path: string, describe: (body: unknown) => string) =>
      check(name, async () => {
        const res = await request(api(path), { token: admin.token });
        expect(res, 200);
        return { detail: describe(await res.json()) };
      });
    const countOf = (body: unknown) => {
      const data = (body as { data?: unknown }).data;
      const meta = (body as { meta?: { total?: number } }).meta;
      return Array.isArray(data) ? (meta?.total ?? data.length) : 0;
    };

    await get('GET /auth/me', '/auth/me', (body) => {
      const role = (body as { data?: { role?: string } }).data?.role;
      if (role !== 'ADMIN') throw new CheckFailure(`role ${String(role)}`);
      return 'ADMIN';
    });
    await get('GET /products', '/products?pageSize=1', (b) => `${String(countOf(b))} products`);
    await get('GET /alerts', '/alerts', (b) => `${String(countOf(b))} alerts`);
    await get('GET /orders', '/orders?pageSize=1', (b) => `${String(countOf(b))} orders`);
    await get('GET /distribution/snapshot', '/distribution/snapshot', (body) => {
      const data = (body as { data?: { orders?: unknown[]; lots?: unknown[] } }).data;
      return `${String(data?.orders?.length ?? 0)} pending orders, ${String(data?.lots?.length ?? 0)} lots`;
    });

    const proposal = (strategy: 'BALANCED' | 'AI_ASSISTED') =>
      check<string>(`POST /distribution/proposals (${strategy})`, async () => {
        const res = await request(api('/distribution/proposals'), {
          method: 'POST',
          token: admin.token,
          json: { strategy },
        });
        expect(res, 201);
        const { data } = (await res.json()) as {
          data: { id: string; degraded: boolean; summary?: { aiError?: string | null } };
        };
        if (strategy === 'AI_ASSISTED' && data.degraded) {
          return {
            outcome: 'WARN',
            detail: `degraded to BALANCED (${data.summary?.aiError ?? 'AI unavailable'})`,
            value: data.id,
          };
        }
        return { detail: 'DRAFT created', value: data.id };
      });
    const discard = (strategy: string, id: string | undefined) =>
      id === undefined
        ? Promise.resolve()
        : check(`POST /proposals/:id/discard (${strategy})`, async () => {
            const res = await request(api(`/distribution/proposals/${id}/discard`), {
              method: 'POST',
              token: admin.token,
            });
            expect(res, 200);
            return { detail: 'DISCARDED: nothing was moved' };
          });
    await discard('BALANCED', await proposal('BALANCED'));
    await discard('AI_ASSISTED', await proposal('AI_ASSISTED'));

    await check('GET /reports/inventory (CSV)', async () => {
      const res = await request(api('/reports/inventory?format=csv&locale=es'), {
        token: admin.token,
      });
      expect(res, 200);
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('text/csv')) throw new CheckFailure(`content-type ${type}`);
      const bytes = (await res.arrayBuffer()).byteLength;
      const server = res.headers.get('x-generation-time-ms');
      return { detail: `${String(bytes)} bytes, generated in ${server ?? '?'} ms` };
    });
    await get('GET /metrics/api', '/metrics/api', (body) => {
      const routes = (body as { data?: { routes?: unknown[] } }).data?.routes?.length ?? 0;
      return `${String(routes)} routes measured`;
    });
  }

  await check('GET /public/impact', async () => {
    const res = await request(api('/public/impact'));
    expect(res, 200);
    const { data } = (await res.json()) as {
      data: { deliveries?: { total?: number }; dispatched?: Record<string, number> };
    };
    const deliveries = data.deliveries?.total ?? 0;
    const units = Object.keys(data.dispatched ?? {}).length;
    return deliveries === 0
      ? { outcome: 'WARN', detail: 'no deliveries in 30 days (run npm run seed:history)' }
      : { detail: `${String(deliveries)} deliveries, ${String(units)} units dispatched` };
  });

  if (operator) {
    await check('OPERATOR → GET /reports/inventory is 403', async () => {
      const res = await request(api('/reports/inventory'), { token: operator.token });
      expect(res, 403);
      return { detail: 'HTTP 403 FORBIDDEN' };
    });
  }
  await check('anonymous → GET /products is 401', async () => {
    const res = await request(api('/products'));
    expect(res, 401);
    return { detail: 'HTTP 401' };
  });

  await check(`CORS preflight from ${config.frontendOrigin}`, async () => {
    const res = await request(api('/auth/login'), {
      method: 'OPTIONS',
      headers: {
        origin: config.frontendOrigin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    const allowed = res.headers.get('access-control-allow-origin');
    if (allowed !== config.frontendOrigin) {
      throw new CheckFailure(`Access-Control-Allow-Origin: ${allowed ?? 'missing'}`);
    }
    if (res.headers.get('access-control-allow-credentials') !== 'true') {
      throw new CheckFailure('credentials not allowed');
    }
    return { detail: `HTTP ${String(res.status)}, origin and credentials allowed` };
  });

  for (const [who, session] of [
    ['ADMIN', admin],
    ['OPERATOR', operator],
  ] as const) {
    if (!session) continue;
    await check(`POST /auth/logout (${who})`, async () => {
      const res = await request(api('/auth/logout'), {
        method: 'POST',
        headers: session.cookie ? { cookie: session.cookie } : {},
      });
      expect(res, 204);
      return { detail: 'HTTP 204, refresh token revoked' };
    });
  }

  return results;
}

/** Plain-text table: | # | check | result | ms | detail |. */
export function renderResults(results: readonly CheckResult[]): string {
  const rows = results.map((r, i) => [String(i + 1), r.name, r.outcome, String(r.ms), r.detail]);
  const header = ['#', 'Check', 'Result', 'ms', 'Detail'];
  const widths = header.map((title, col) =>
    Math.max(title.length, ...rows.map((row) => (row[col] ?? '').length)),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join(' | ')} |`;
  const count = (outcome: Outcome) => results.filter((r) => r.outcome === outcome).length;
  return [
    line(header),
    `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`,
    ...rows.map(line),
    '',
    `PASS ${String(count('PASS'))} · WARN ${String(count('WARN'))} · FAIL ${String(count('FAIL'))}`,
  ].join('\n');
}

/** Non-zero when any check failed; warnings do not fail the run. */
export function exitCodeOf(results: readonly CheckResult[]): number {
  return results.some((r) => r.outcome === 'FAIL') ? 1 : 0;
}

export interface WarmTarget {
  name: string;
  url: string;
}

/**
 * --warm: pings each service until it answers 200 (Render's free services
 * sleep and take up to about a minute to wake), all at the same time.
 */
export async function warmUp(
  targets: readonly WarmTarget[],
  {
    fetch: doFetch = fetch,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = () => performance.now(),
    intervalMs = 5_000,
    deadlineMs = 180_000,
  }: {
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    intervalMs?: number;
    deadlineMs?: number;
  } = {},
): Promise<CheckResult[]> {
  return Promise.all(
    targets.map(async ({ name, url }) => {
      const started = now();
      let attempts = 0;
      let last = 'no answer';
      while (now() - started < deadlineMs) {
        attempts += 1;
        try {
          const res = await doFetch(url, { signal: AbortSignal.timeout(intervalMs * 6) });
          if (res.status === 200) {
            return {
              name,
              outcome: 'PASS' as const,
              ms: Math.round(now() - started),
              detail: `HTTP 200 after ${String(attempts)} attempt${attempts === 1 ? '' : 's'}`,
            };
          }
          last = `HTTP ${String(res.status)}`;
        } catch (error) {
          last = error instanceof Error ? error.name : 'error';
        }
        await sleep(intervalMs);
      }
      return {
        name,
        outcome: 'FAIL' as const,
        ms: Math.round(now() - started),
        detail: `${last} after ${String(attempts)} attempts`,
      };
    }),
  );
}
