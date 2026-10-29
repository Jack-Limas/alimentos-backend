import { describe, expect, it } from 'vitest';
import { BENCH_PREFIX, BENCH_SIZES, buildBenchData, inBatches } from '../src/seed/bench-data.js';
import { checkBenchTarget, hostOf, parseConfirmHost } from '../src/seed/bench-guard.js';

const URL_BENCH =
  'postgresql://user:secret-password@ep-bench-123.us-east-2.aws.neon.tech/neondb?sslmode=require';

describe('seed:bench guard', () => {
  it('reads --confirm-host in both forms', () => {
    expect(parseConfirmHost(['--confirm-host=ep-bench-123.us-east-2.aws.neon.tech'])).toBe(
      'ep-bench-123.us-east-2.aws.neon.tech',
    );
    expect(parseConfirmHost(['--confirm-host', 'h'])).toBe('h');
    expect(parseConfirmHost(['--confirm-host='])).toBeUndefined();
    expect(parseConfirmHost([])).toBeUndefined();
  });

  it('only ever shows the host, never the user or the password', () => {
    expect(hostOf(URL_BENCH)).toBe('ep-bench-123.us-east-2.aws.neon.tech');
    expect(
      JSON.stringify(
        checkBenchTarget({ databaseUrl: URL_BENCH, confirmHost: 'other', nodeEnv: 'development' }),
      ),
    ).not.toContain('secret');
  });

  it('runs only when the confirmed host matches and NODE_ENV is not production', () => {
    const base = { databaseUrl: URL_BENCH, nodeEnv: 'development' };
    expect(
      checkBenchTarget({ ...base, confirmHost: 'EP-BENCH-123.us-east-2.aws.neon.tech' }),
    ).toEqual({
      ok: true,
      host: 'ep-bench-123.us-east-2.aws.neon.tech',
    });
    expect(checkBenchTarget({ ...base, confirmHost: undefined })).toMatchObject({
      ok: false,
      reason: 'MISSING_CONFIRM_HOST',
    });
    expect(checkBenchTarget({ ...base, confirmHost: 'ep-main-999.neon.tech' })).toMatchObject({
      ok: false,
      reason: 'HOST_MISMATCH',
    });
    expect(
      checkBenchTarget({
        ...base,
        nodeEnv: 'production',
        confirmHost: 'ep-bench-123.us-east-2.aws.neon.tech',
      }),
    ).toEqual({ ok: false, reason: 'PRODUCTION' });
    expect(
      checkBenchTarget({ databaseUrl: 'not a url', confirmHost: 'x', nodeEnv: 'development' }),
    ).toMatchObject({
      ok: false,
      reason: 'INVALID_DATABASE_URL',
    });
  });
});

describe('bench data', () => {
  const now = new Date('2026-10-28T15:00:00Z');
  const sizes = { products: 50, lots: 400, orders: 120, customers: 10 };
  const data = buildBenchData({ today: '2026-10-28', now, userId: 'admin', sizes });

  it('has the requested sizes and the default ones are the large bench', () => {
    expect(BENCH_SIZES).toEqual({ products: 2_000, lots: 20_000, orders: 5_000, customers: 80 });
    expect(data.products).toHaveLength(50);
    expect(data.lots).toHaveLength(400);
    expect(data.movements).toHaveLength(400);
    expect(data.orders).toHaveLength(120);
    expect(data.history).toHaveLength(120);
    expect(data.items.length).toBeGreaterThanOrEqual(120);
  });

  it('keeps every reference valid and the unique keys unique', () => {
    const products = new Set(data.products.map((p) => p.id));
    const orders = new Set(data.orders.map((o) => o.id));
    const customers = new Set(data.customers.map((c) => c.id));
    const lots = new Set(data.lots.map((l) => l.id));
    expect(new Set(data.products.map((p) => p.name)).size).toBe(50);
    expect(data.products.every((p) => p.name.startsWith(`${BENCH_PREFIX} `))).toBe(true);
    expect(data.lots.every((l) => products.has(l.productId))).toBe(true);
    expect(
      data.movements.every(
        (m) =>
          lots.has(m.lotId) && m.quantity === data.lots.find((l) => l.id === m.lotId)?.quantity,
      ),
    ).toBe(true);
    expect(data.orders.every((o) => customers.has(o.customerId))).toBe(true);
    expect(data.items.every((i) => orders.has(i.orderId) && products.has(i.productId))).toBe(true);
    const pairs = data.items.map((i) => `${i.orderId}|${i.productId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('splits rows in batches for createMany', () => {
    expect(inBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(inBatches([], 1000)).toEqual([]);
  });
});
