import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiMetrics, createWebVitalsStore } from '../src/modules/metrics/index.js';
import {
  call,
  type InventoryTestContext,
  buildInventoryTestApp,
} from './helpers/inventory-fixtures.js';

let context: InventoryTestContext;

beforeEach(async () => {
  context = await buildInventoryTestApp();
});

afterEach(async () => {
  await context.app.close();
});

interface RouteRow {
  route: string;
  total: number;
  errors5xx: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

describe('GET /metrics/api', () => {
  it('groups response times by route pattern, never by URL with IDs', async () => {
    for (const id of [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]) {
      await call(context.app, context.adminToken, 'GET', `/api/v1/products/${id}`);
    }
    await call(context.app, context.adminToken, 'GET', '/api/v1/products');

    const res = await call(context.app, context.adminToken, 'GET', '/api/v1/metrics/api');
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: {
        routes: RouteRow[];
        memory: { heapUsed: number };
        eventLoop: { p99Ms: number; maxMs: number };
        uptimeSec: number;
      };
    }>().data;

    const detail = body.routes.find((r) => r.route === 'GET /api/v1/products/:id');
    expect(detail).toMatchObject({ total: 2, errors5xx: 0 });
    expect(detail?.p95).toBeGreaterThanOrEqual(0);
    expect(body.routes.some((r) => r.route.includes('1111'))).toBe(false);
    expect(body.memory.heapUsed).toBeGreaterThan(0);
    expect(body.eventLoop.maxMs).toBeGreaterThanOrEqual(0);
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it('is ADMIN only', async () => {
    expect(
      (await call(context.app, context.operatorToken, 'GET', '/api/v1/metrics/api')).statusCode,
    ).toBe(403);
    expect(
      (await context.app.inject({ method: 'GET', url: '/api/v1/metrics/api' })).statusCode,
    ).toBe(401);
  });
});

describe('api metrics store', () => {
  it('counts 5xx and keeps the percentiles of the last 500 only', () => {
    const metrics = createApiMetrics();
    for (let i = 1; i <= 600; i += 1) metrics.record('GET /x', i, i % 100 === 0 ? 503 : 200);
    const [row] = metrics.routes();
    expect(row).toMatchObject({
      route: 'GET /x',
      total: 600,
      errors5xx: 6,
      count: 500,
      p50: 350,
      p99: 595,
    });
  });
});

describe('web vitals', () => {
  const vital = { name: 'LCP', value: 1800, rating: 'good', page: '/[locale]/app/orders' };

  it('accepts valid vitals from both roles and reports p75 per metric and page (ADMIN)', async () => {
    for (const [token, value] of [
      [context.operatorToken, 1000],
      [context.adminToken, 2000],
      [context.adminToken, 3000],
      [context.operatorToken, 4000],
    ] as const) {
      const res = await call(context.app, token, 'POST', '/api/v1/metrics/web-vitals', {
        ...vital,
        value,
      });
      expect(res.statusCode).toBe(204);
    }
    await call(context.app, context.adminToken, 'POST', '/api/v1/metrics/web-vitals', {
      name: 'INP',
      value: 120,
      rating: 'good',
      page: '/[locale]/app',
    });

    const res = await call(context.app, context.adminToken, 'GET', '/api/v1/metrics/web-vitals');
    expect(res.json()).toEqual({
      data: {
        byMetric: [
          { name: 'INP', count: 1, p75: 120 },
          { name: 'LCP', count: 4, p75: 3000 },
        ],
        byPage: [
          { page: '/[locale]/app', name: 'INP', count: 1, p75: 120 },
          { page: '/[locale]/app/orders', name: 'LCP', count: 4, p75: 3000 },
        ],
      },
    });
    expect(
      (await call(context.app, context.operatorToken, 'GET', '/api/v1/metrics/web-vitals'))
        .statusCode,
    ).toBe(403);
  });

  it.each([
    ['an unknown metric', { ...vital, name: 'FID' }],
    ['a negative value', { ...vital, value: -1 }],
    ['an absurd value', { ...vital, value: 1e9 }],
    ['an unknown rating', { ...vital, rating: 'bad' }],
    ['a page with a query string', { ...vital, page: '/app/orders?email=a@b.co' }],
    ['a full URL', { ...vital, page: 'https://evil.example/x' }],
    ['extra fields', { ...vital, userAgent: 'x' }],
  ])('rejects %s with 400', async (_case, body) => {
    expect(
      (await call(context.app, context.adminToken, 'POST', '/api/v1/metrics/web-vitals', body))
        .statusCode,
    ).toBe(400);
  });

  it('keeps a bounded number of samples', () => {
    const store = createWebVitalsStore(3);
    for (const value of [1, 2, 3, 4, 5])
      store.add({ ...vital, name: 'LCP', rating: 'good', value });
    expect(store.report().byMetric).toEqual([{ name: 'LCP', count: 3, p75: 5 }]);
  });
});
