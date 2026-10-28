import type { CustomerType, OrderPriority } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/modules/ai/index.js';
import type { ProposalDetailDto } from '../src/modules/distribution/index.js';
import { addDays } from '../src/modules/inventory/domain/index.js';
import { ADMIN, buildAuthTestApp, login, OPERATOR } from './helpers/auth-fixtures.js';
import {
  addProduct,
  call,
  TODAY,
  type InventoryTestContext,
} from './helpers/inventory-fixtures.js';
import { addCustomer, auditActions } from './helpers/order-fixtures.js';

const NOW = new Date('2026-10-26T15:00:00Z');
const INTERNAL_KEY = 'internal-key-for-tests-0123456789abcdef';
const AI_ENV = {
  AI_SERVICE_URL: 'http://ai.test:4100',
  AI_INTERNAL_KEY: INTERNAL_KEY,
  AI_TIMEOUT_MS: 50,
};

interface AiCall {
  path: string;
  body: Record<string, unknown>;
}

/** A fake alimentos-ai: answers from the request, or fails like a dead service. */
function fakeAi() {
  const state = { down: false, tieBreakOrder: [] as string[], calls: [] as AiCall[] };
  const meta = {
    model: 'gemini-fake',
    promptVersion: 'test@1',
    latencyMs: 7,
    attempts: 1,
    discardedItems: 0,
  };
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  const fetch = (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    state.calls.push({ path, body });
    if (state.down) return Promise.reject(new TypeError('fetch failed'));
    switch (path) {
      case '/v1/proposal-explanation':
        return Promise.resolve(
          json({
            summary: 'Primero lo urgente.',
            highlights: ['Se atiende el pedido más urgente.'],
            ...(state.tieBreakOrder.length > 0 ? { tieBreakOrder: state.tieBreakOrder } : {}),
            meta,
          }),
        );
      case '/v1/rescue-plan': {
        const products = body.products as { name: string }[];
        return Promise.resolve(
          json({
            actions: products.map((p) => ({
              product: p.name,
              action: 'DONATE',
              rationale: 'Vence pronto.',
            })),
            meta,
          }),
        );
      }
      default:
        return Promise.resolve(
          json({ summary: 'Día tranquilo.', topActions: ['Revisa los pedidos.'], meta }),
        );
    }
  };
  return { state, fetch: fetch as unknown as typeof globalThis.fetch };
}

type Context = InventoryTestContext & { ai: ReturnType<typeof fakeAi> };
let context: Context | undefined;

async function setup(
  env: Partial<typeof AI_ENV> = AI_ENV,
  limiter = createRateLimiter({ now: () => 0 }),
) {
  const ai = fakeAi();
  const base = await buildAuthTestApp({ clock: () => NOW, env, ai: { fetch: ai.fetch, limiter } });
  const tokenOf = async (user: { email: string; password: string }) =>
    (await login(base.app, user)).json<{ accessToken: string }>().accessToken;
  context = {
    ...base,
    ai,
    adminToken: await tokenOf(ADMIN),
    operatorToken: await tokenOf(OPERATOR),
  };
  return context;
}

afterEach(async () => {
  await context?.app.close();
  context = undefined;
});

const day = (offset: number) => new Date(`${addDays(TODAY, offset)}T00:00:00.000Z`);

function addOrder(
  ctx: Context,
  priority: OrderPriority,
  dueIn: number,
  productId: string,
  type: CustomerType,
) {
  const customer = addCustomer(ctx, { name: `Cliente secreto ${priority} ${type}`, type });
  return ctx.repositories.orders.addOrder(
    { customerId: customer.id, createdById: ctx.admin.id, priority, dueDate: day(dueIn) },
    [{ productId, requestedQty: 1 }],
  );
}

/** URGENT first (75), two HIGH orders tied at 47.5, a MEDIUM one 2.5 behind (45). */
function seedTies(ctx: Context) {
  const rice = addProduct(ctx, { name: 'Arroz blanco' });
  ctx.repositories.inventory.addLot({
    productId: rice.id,
    quantity: 100,
    expiryDate: addDays(TODAY, 60),
    receivedAt: new Date('2026-10-01T12:00:00Z'),
  });
  const urgent = addOrder(ctx, 'URGENT', 0, rice.id, 'HOSPITAL');
  const tiedA = addOrder(ctx, 'HIGH', 7, rice.id, 'SCHOOL');
  const tiedB = addOrder(ctx, 'HIGH', 7, rice.id, 'RESTAURANT');
  const medium = addOrder(ctx, 'MEDIUM', 4, rice.id, 'FOOD_BANK');
  return { rice, urgent, tiedA, tiedB, medium };
}

const create = (ctx: Context, body: unknown) =>
  call(ctx.app, ctx.adminToken, 'POST', '/api/v1/distribution/proposals', body);
const dataOf = (res: LightMyRequestResponse) => res.json<{ data: ProposalDetailDto }>().data;
const codes = (proposal: ProposalDetailDto) => proposal.orders.map((o) => o.code);
const post = (ctx: Context, url: string, token = ctx.adminToken, payload: unknown = {}) =>
  call(ctx.app, token, 'POST', `/api/v1/ai${url}`, payload);

describe('AI_ASSISTED proposals', () => {
  it('reorders only the tied orders with the AI ranks and stores the explanation', async () => {
    const ctx = await setup();
    seedTies(ctx);
    const balanced = dataOf(await create(ctx, { strategy: 'BALANCED' }));
    const [first, a, b, last] = codes(balanced);
    expect(balanced.orders.map((o) => o.score)).toEqual([75, 47.5, 47.5, 45]);
    // The AI asks for B before A, and tries to move the non-tied orders too.
    ctx.ai.state.tieBreakOrder = [String(b), String(last), String(a), String(first)];

    const res = await create(ctx, { strategy: 'AI_ASSISTED', locale: 'es' });

    expect(res.statusCode).toBe(201);
    const assisted = dataOf(res);
    expect(codes(assisted)).toEqual([first, b, a, last]);
    expect(assisted).toMatchObject({
      strategy: 'AI_ASSISTED',
      degraded: false,
      summary: { tieGroups: 1 },
      aiInsight: { summary: 'Primero lo urgente.', locale: 'es', model: 'gemini-fake' },
    });
    expect(assisted.summary).not.toHaveProperty('aiError');
  });

  it('sends customer types, never customer names, emails or phones', async () => {
    const ctx = await setup();
    seedTies(ctx);
    await create(ctx, { strategy: 'AI_ASSISTED' });

    const sent = JSON.stringify(ctx.ai.state.calls[0]?.body);
    expect(sent).not.toMatch(/Cliente secreto|@|Cra 7|customerName|email|phone/);
    expect(sent).toContain('"customerType":"HOSPITAL"');
    expect(ctx.ai.state.calls[0]?.body).toMatchObject({
      locale: 'es',
      role: 'ADMIN',
      strategy: 'AI_ASSISTED',
    });
  });

  it('falls back to BALANCED with degraded and aiError when the AI is down', async () => {
    const ctx = await setup();
    seedTies(ctx);
    const balanced = dataOf(await create(ctx, { strategy: 'BALANCED' }));
    ctx.ai.state.down = true;

    const res = await create(ctx, { strategy: 'AI_ASSISTED' });

    expect(res.statusCode).toBe(201);
    expect(dataOf(res)).toMatchObject({
      degraded: true,
      aiInsight: null,
      summary: { aiError: 'UPSTREAM_ERROR', tieGroups: 1 },
    });
    expect(codes(dataOf(res))).toEqual(codes(balanced));
    // One retry after the network error.
    expect(ctx.ai.state.calls).toHaveLength(2);
    expect(auditActions(ctx)).toContain('AI_REQUESTED');
  });
});

describe('POST /ai/proposals/:id/explanation', () => {
  it('generates and stores the explanation, then serves it from aiInsight', async () => {
    const ctx = await setup();
    seedTies(ctx);
    const proposal = dataOf(await create(ctx, { strategy: 'BALANCED' }));
    const url = `/proposals/${proposal.id}/explanation`;

    const first = await post(ctx, url, ctx.operatorToken);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      data: {
        summary: 'Primero lo urgente.',
        highlights: ['Se atiende el pedido más urgente.'],
        locale: 'es',
      },
      meta: { model: 'gemini-fake', cached: false },
    });
    expect(ctx.ai.state.calls[0]?.body).toMatchObject({ role: 'OPERATOR', strategy: 'BALANCED' });

    const second = await post(ctx, url);
    expect(second.json()).toMatchObject({ meta: { cached: true, latencyMs: 0 } });
    expect(ctx.ai.state.calls).toHaveLength(1);

    const stored = dataOf(
      await call(ctx.app, ctx.adminToken, 'GET', `/api/v1/distribution/proposals/${proposal.id}`),
    );
    expect(stored.aiInsight?.summary).toBe('Primero lo urgente.');

    expect((await post(ctx, `${url}?refresh=true`)).json()).toMatchObject({
      meta: { cached: false },
    });
    expect((await post(ctx, url, ctx.adminToken, { locale: 'en' })).json()).toMatchObject({
      data: { locale: 'en' },
      meta: { cached: false },
    });
    expect(ctx.ai.state.calls).toHaveLength(3);
  });

  it('answers 503 AI_UNAVAILABLE with the category when the AI fails, and 404 for an unknown proposal', async () => {
    const ctx = await setup();
    seedTies(ctx);
    const proposal = dataOf(await create(ctx, { strategy: 'BALANCED' }));
    ctx.ai.state.down = true;

    const res = await post(ctx, `/proposals/${proposal.id}/explanation`);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: { code: 'AI_UNAVAILABLE', details: { category: 'UPSTREAM_ERROR' } },
    });

    const missing = await post(ctx, '/proposals/00000000-0000-4000-8000-000000000000/explanation');
    expect(missing.statusCode).toBe(404);
  });
});

describe('POST /ai/rescue-plan and /ai/briefing', () => {
  function seedRisk(ctx: Context) {
    const yogurt = addProduct(ctx, { name: 'Yogur natural', category: 'DAIRY', unit: 'L' });
    ctx.repositories.inventory.addLot({
      productId: yogurt.id,
      quantity: 20,
      expiryDate: addDays(TODAY, 4),
      receivedAt: new Date('2026-10-20T12:00:00Z'),
    });
    addCustomer(ctx, { name: 'Banco de alimentos secreto', type: 'FOOD_BANK' });
    return yogurt;
  }

  it('builds the rescue plan from HIGH waste risk products and active customer types (ADMIN)', async () => {
    const ctx = await setup();
    seedRisk(ctx);

    const res = await post(ctx, '/rescue-plan');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      data: { actions: [{ product: 'Yogur natural', action: 'DONATE' }] },
      meta: { model: 'gemini-fake', cached: false },
    });
    expect(ctx.ai.state.calls[0]?.body).toEqual({
      locale: 'es',
      products: [
        {
          name: 'Yogur natural',
          category: 'DAIRY',
          qty: 20,
          unit: 'L',
          daysToExpiry: 4,
          avgDailyOut: 0,
        },
      ],
      customerTypes: ['FOOD_BANK'],
    });
  });

  it('does not call the AI when no product is at risk', async () => {
    const ctx = await setup();

    expect((await post(ctx, '/rescue-plan')).json()).toEqual({
      data: { actions: [] },
      meta: { model: null, latencyMs: 0, cached: false },
    });
    expect(ctx.ai.state.calls).toHaveLength(0);
  });

  it('refuses the rescue plan to an OPERATOR and to anonymous users', async () => {
    const ctx = await setup();

    expect((await post(ctx, '/rescue-plan', ctx.operatorToken)).statusCode).toBe(403);
    const anonymous = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/ai/briefing',
      payload: {},
    });
    expect(anonymous.statusCode).toBe(401);
    expect(ctx.ai.state.calls).toHaveLength(0);
  });

  it('gives the OPERATOR a briefing with operational data only', async () => {
    const ctx = await setup();
    seedTies(ctx);
    seedRisk(ctx);

    const res = await post(ctx, '/briefing', ctx.operatorToken, { locale: 'en' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      data: { summary: 'Día tranquilo.' },
      meta: { cached: false },
    });
    const body = ctx.ai.state.calls[0]?.body as {
      role: string;
      locale: string;
      alerts: { type: string }[];
      pendingOrders: Record<string, unknown>[];
      kpis: Record<string, number>;
    };
    expect(body).toMatchObject({ role: 'OPERATOR', locale: 'en' });
    expect(body.alerts.map((a) => a.type)).not.toContain('WASTE_RISK');
    expect(body.pendingOrders).toHaveLength(4);
    expect(body.pendingOrders[0]).not.toHaveProperty('customerType');
    expect(Object.keys(body.kpis).sort()).toEqual([
      'expiringSoon',
      'lowStock',
      'outOfStock',
      'pendingOrders',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/secreto|Yogur/);
  });

  it('gives the ADMIN customer types and every KPI', async () => {
    const ctx = await setup();
    seedTies(ctx);

    await post(ctx, '/briefing');

    const body = ctx.ai.state.calls[0]?.body as {
      pendingOrders: { orderCode: string; customerType?: string }[];
      kpis: object;
    };
    expect(body.pendingOrders[0]).toMatchObject({ customerType: 'HOSPITAL' });
    expect(body.kpis).toMatchObject({ totalProducts: 1, pendingOrders: 4 });
  });

  it('answers 503 NOT_CONFIGURED when the AI variables are missing', async () => {
    const ctx = await setup({});

    const res = await post(ctx, '/briefing');

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: { code: 'AI_UNAVAILABLE', details: { category: 'NOT_CONFIGURED' } },
    });
    expect(ctx.ai.state.calls).toHaveLength(0);
  });
});

describe('AI rate limit', () => {
  it('allows 10 calls per minute per user, then 429 with Retry-After', async () => {
    const ctx = await setup(AI_ENV, createRateLimiter({ now: () => 5_000 }));

    for (let i = 0; i < 10; i += 1) {
      expect((await post(ctx, '/briefing')).statusCode).toBe(200);
    }
    const limited = await post(ctx, '/briefing');
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.json()).toMatchObject({
      error: { code: 'TOO_MANY_REQUESTS', details: { retryAfterSec: 60 } },
    });

    // Another user has its own budget.
    expect((await post(ctx, '/briefing', ctx.operatorToken)).statusCode).toBe(200);
    expect(ctx.ai.state.calls).toHaveLength(11);
  });

  it('records one AI_REQUESTED audit row per real call', async () => {
    const ctx = await setup();
    await post(ctx, '/briefing');

    const rows = ctx.repositories.auditLogs.entries.filter((e) => e.action === 'AI_REQUESTED');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toMatchObject({
      endpoint: 'briefing',
      category: 'OK',
      model: 'gemini-fake',
    });
  });
});
