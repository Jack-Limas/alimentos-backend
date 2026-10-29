import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeImpact, IMPACT_CACHE_CONTROL } from '../src/modules/public/index.js';
import { createRateLimiter } from '../src/shared/http/rate-limiter.js';
import { addDays } from '../src/modules/inventory/domain/index.js';
import { buildAuthTestApp } from './helpers/auth-fixtures.js';
import { addProduct, TODAY, type InventoryTestContext } from './helpers/inventory-fixtures.js';
import { addCustomer } from './helpers/order-fixtures.js';

const NOW = new Date('2026-10-26T15:00:00Z');
const BOGOTA = 'America/Bogota';
const date = (calendar: string) => new Date(`${calendar}T00:00:00.000Z`);

describe('computeImpact', () => {
  it('adds dispatched and rescued quantity per unit, in the business time zone', () => {
    const impact = computeImpact({
      now: NOW,
      timeZone: BOGOTA,
      deliveries: [],
      dispatches: [
        // 7 days to expiry on the dispatch day: rescued.
        {
          createdAt: new Date('2026-10-20T15:00:00Z'),
          unit: 'KG',
          quantity: 10.5,
          expiryDate: date('2026-10-27'),
        },
        // 8 days: just dispatched.
        {
          createdAt: new Date('2026-10-20T15:00:00Z'),
          unit: 'KG',
          quantity: 4,
          expiryDate: date('2026-10-28'),
        },
        // 23:30 in Bogota on the 20th is the 21st in UTC: 6 days left, rescued.
        {
          createdAt: new Date('2026-10-21T04:30:00Z'),
          unit: 'L',
          quantity: 0.1,
          expiryDate: date('2026-10-26'),
        },
        {
          createdAt: new Date('2026-10-21T04:30:00Z'),
          unit: 'L',
          quantity: 0.2,
          expiryDate: date('2026-10-26'),
        },
      ],
    });
    expect(impact.dispatched).toEqual({ KG: 14.5, L: 0.3 });
    expect(impact.rescued).toEqual({ KG: 10.5, L: 0.3 });
    expect(impact).toMatchObject({
      windowDays: 30,
      from: '2026-09-27',
      to: '2026-10-26',
      rescueDays: 7,
    });
  });

  it('counts on-time deliveries and distinct customers by type', () => {
    const impact = computeImpact({
      now: NOW,
      timeZone: BOGOTA,
      dispatches: [],
      deliveries: [
        {
          customerId: 'a',
          customerType: 'SCHOOL',
          deliveredAt: new Date('2026-10-20T23:00:00Z'),
          dueDate: date('2026-10-20'),
        },
        {
          customerId: 'a',
          customerType: 'SCHOOL',
          deliveredAt: new Date('2026-10-22T15:00:00Z'),
          dueDate: date('2026-10-21'),
        },
        {
          customerId: 'b',
          customerType: 'HOSPITAL',
          deliveredAt: new Date('2026-10-23T15:00:00Z'),
          dueDate: date('2026-10-25'),
        },
      ],
    });
    expect(impact.deliveries).toEqual({ total: 3, onTime: 2, onTimePct: 66.7 });
    expect(impact.customersServed).toEqual({ total: 2, byType: { HOSPITAL: 1, SCHOOL: 1 } });
  });

  it('has no percentage without deliveries', () => {
    expect(
      computeImpact({ now: NOW, timeZone: BOGOTA, dispatches: [], deliveries: [] }).deliveries,
    ).toEqual({
      total: 0,
      onTime: 0,
      onTimePct: null,
    });
  });
});

describe('GET /public/impact', () => {
  let context: InventoryTestContext;
  let now = NOW;

  beforeEach(async () => {
    now = NOW;
    const base = await buildAuthTestApp({
      clock: () => now,
      publicLimiter: createRateLimiter({ max: 60, windowMs: 60_000, now: () => now.getTime() }),
    });
    context = { ...base, adminToken: '', operatorToken: '' };
    const rice = addProduct(context, { name: 'Arroz blanco' });
    const lot = context.repositories.inventory.addLot({
      productId: rice.id,
      quantity: 100,
      // Expires 5 days after the dispatch below (2026-10-23): rescued.
      expiryDate: addDays(TODAY, 2),
      receivedAt: new Date('2026-10-01T12:00:00Z'),
    });
    const customer = addCustomer(context, { name: 'Hospital San José', type: 'HOSPITAL' });
    const order = context.repositories.orders.addOrder(
      {
        customerId: customer.id,
        createdById: context.admin.id,
        status: 'DELIVERED',
        dueDate: date('2026-10-25'),
      },
      [{ productId: rice.id, requestedQty: 20 }],
    );
    context.repositories.orders.history.push({
      id: 'h1',
      orderId: order.id,
      fromStatus: 'SHIPPED',
      toStatus: 'DELIVERED',
      userId: context.admin.id,
      note: null,
      createdAt: new Date('2026-10-24T15:00:00Z'),
    });
    context.repositories.inventory.addMovement({
      lotId: lot.id,
      type: 'EXIT_DISPATCH',
      quantity: 20,
      reason: null,
      orderId: order.id,
      userId: context.admin.id,
      createdAt: new Date('2026-10-23T15:00:00Z'),
    });
  });

  afterEach(async () => {
    await context.app.close();
  });

  const get = (ip = '203.0.113.7') =>
    context.app.inject({
      method: 'GET',
      url: '/api/v1/public/impact',
      headers: { 'x-forwarded-for': ip },
    });

  it('answers without authentication, with aggregates and a public cache header', async () => {
    const res = await get();

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(IMPACT_CACHE_CONTROL);
    expect(res.json()).toEqual({
      data: {
        windowDays: 30,
        from: '2026-09-27',
        to: '2026-10-26',
        dispatched: { KG: 20 },
        rescued: { KG: 20 },
        rescueDays: 7,
        deliveries: { total: 1, onTime: 1, onTimePct: 100 },
        customersServed: { total: 1, byType: { HOSPITAL: 1 } },
        generatedAt: NOW.toISOString(),
      },
    });
  });

  it('never exposes names, ids, emails or phones', async () => {
    const body = (await get()).body;
    expect(body).not.toMatch(
      /Hospital San José|Arroz|@|[0-9a-f]{8}-[0-9a-f]{4}-|phone|email|name/i,
    );
  });

  it('caches the result for a minute on the server', async () => {
    const first = (await get()).json<{ data: { generatedAt: string } }>().data.generatedAt;
    now = new Date(NOW.getTime() + 30_000);
    expect((await get()).json<{ data: { generatedAt: string } }>().data.generatedAt).toBe(first);
    now = new Date(NOW.getTime() + 61_000);
    expect((await get()).json<{ data: { generatedAt: string } }>().data.generatedAt).not.toBe(
      first,
    );
  });

  it('allows 60 requests per minute and IP, then 429 with Retry-After', async () => {
    for (let i = 0; i < 60; i += 1) expect((await get()).statusCode).toBe(200);
    const limited = await get();
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect((await get('198.51.100.2')).statusCode).toBe(200);
  });
});
