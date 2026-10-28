import type { OrderPriority } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProposalDetailDto, SnapshotDto } from '../src/modules/distribution/index.js';
import { addDays } from '../src/modules/inventory/domain/index.js';
import { ADMIN, buildAuthTestApp, login } from './helpers/auth-fixtures.js';
import {
  addProduct,
  call,
  OPERATOR,
  TODAY,
  type InventoryTestContext,
} from './helpers/inventory-fixtures.js';
import { addCustomer, auditActions } from './helpers/order-fixtures.js';

const URL = '/api/v1/distribution';
let now = new Date('2026-10-26T15:00:00Z');
let context: InventoryTestContext;

beforeEach(async () => {
  now = new Date('2026-10-26T15:00:00Z');
  const base = await buildAuthTestApp({ clock: () => now });
  const tokenOf = async (user: { email: string; password: string }) =>
    (await login(base.app, user)).json<{ accessToken: string }>().accessToken;
  context = { ...base, adminToken: await tokenOf(ADMIN), operatorToken: await tokenOf(OPERATOR) };
});

afterEach(async () => {
  await context.app.close();
});

const day = (offset: number) => new Date(`${addDays(TODAY, offset)}T00:00:00.000Z`);

function addLot(productId: string, quantity: number, expiresIn: number, receivedDaysAgo = 5) {
  return context.repositories.inventory.addLot({
    productId,
    quantity,
    expiryDate: addDays(TODAY, expiresIn),
    receivedAt: new Date(now.getTime() - receivedDaysAgo * 86_400_000),
  });
}

function addOrder(
  priority: OrderPriority,
  dueIn: number,
  lines: { productId: string; requestedQty: number }[],
  status: 'PENDING' | 'CANCELLED' = 'PENDING',
) {
  const customer = addCustomer(context, { name: `Cliente ${priority}` });
  return context.repositories.orders.addOrder(
    {
      customerId: customer.id,
      createdById: context.admin.id,
      priority,
      dueDate: day(dueIn),
      status,
    },
    lines,
  );
}

/** Rice has a lot expiring in 3 days and one in 40; milk is short; bread has no stock. */
function seed() {
  const rice = addProduct(context, { name: 'Arroz', unit: 'KG' });
  const milk = addProduct(context, { name: 'Leche', unit: 'L' });
  const bread = addProduct(context, { name: 'Pan', unit: 'UNIT' });
  const riceSoon = addLot(rice.id, 10, 3);
  const riceLater = addLot(rice.id, 50, 40);
  const milkLot = addLot(milk.id, 4, 6);
  const urgent = addOrder('URGENT', 0, [
    { productId: rice.id, requestedQty: 12 },
    { productId: milk.id, requestedQty: 3 },
  ]);
  const low = addOrder('LOW', 10, [
    { productId: milk.id, requestedQty: 5 },
    { productId: bread.id, requestedQty: 2 },
  ]);
  const noStock = addOrder('MEDIUM', 5, [{ productId: bread.id, requestedQty: 6 }]);
  return { rice, milk, bread, riceSoon, riceLater, milkLot, urgent, low, noStock };
}

const create = (body: unknown = { strategy: 'BALANCED' }, token = context.adminToken) =>
  call(context.app, token, 'POST', `${URL}/proposals`, body);
const dataOf = (res: LightMyRequestResponse) => res.json<{ data: ProposalDetailDto }>().data;
const errorOf = (res: LightMyRequestResponse) =>
  res.json<{ error: { code: string; details: Record<string, unknown> } }>().error;
const qty = (lotId: string) => context.repositories.inventory.lots.get(lotId)?.quantity.toNumber();

describe('distribution: roles', () => {
  it('requires authentication on every route', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const responses = await Promise.all([
      context.app.inject({ method: 'GET', url: `${URL}/snapshot` }),
      context.app.inject({ method: 'POST', url: `${URL}/proposals`, payload: {} }),
      context.app.inject({ method: 'GET', url: `${URL}/proposals` }),
      context.app.inject({ method: 'GET', url: `${URL}/proposals/${id}` }),
      context.app.inject({ method: 'POST', url: `${URL}/proposals/${id}/confirm` }),
      context.app.inject({ method: 'POST', url: `${URL}/proposals/${id}/discard` }),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([401, 401, 401, 401, 401, 401]);
  });

  it('lets an OPERATOR read the snapshot, generate and confirm', async () => {
    seed();
    const op = context.operatorToken;
    expect((await call(context.app, op, 'GET', `${URL}/snapshot`)).statusCode).toBe(200);
    const created = await create({ strategy: 'URGENCY_FIRST' }, op);
    expect(created.statusCode).toBe(201);
    const confirmed = await call(
      context.app,
      op,
      'POST',
      `${URL}/proposals/${dataOf(created).id}/confirm`,
    );
    expect(confirmed.statusCode).toBe(200);
  });
});

describe('GET /distribution/snapshot', () => {
  it('returns PENDING orders, dispatchable lots, outflow, weights and rules', async () => {
    const { rice, riceSoon, riceLater, urgent } = seed();
    addLot(rice.id, 9, 0); // expires today: not dispatchable
    addLot(rice.id, 9, -2); // expired
    addOrder('HIGH', 1, [{ productId: rice.id, requestedQty: 1 }], 'CANCELLED');
    context.repositories.inventory.addMovement({
      lotId: riceLater.id,
      type: 'EXIT_DISPATCH',
      quantity: 60,
      reason: null,
      orderId: null,
      userId: context.admin.id,
      createdAt: new Date(now.getTime() - 3 * 86_400_000),
    });

    const res = await call(context.app, context.operatorToken, 'GET', `${URL}/snapshot`);
    const data = res.json<{ data: SnapshotDto }>().data;

    expect(data.businessDate).toBe(TODAY);
    expect(data.orders).toHaveLength(3);
    expect(data.orders[0]).toMatchObject({ id: urgent.id, code: 'PED-000001', priority: 'URGENT' });
    expect(data.lots.filter((l) => l.productId === rice.id).map((l) => l.id)).toEqual([
      riceSoon.id,
      riceLater.id,
    ]);
    expect(data.products.find((p) => p.id === rice.id)).toMatchObject({
      name: 'Arroz',
      unit: 'KG',
      avgDailyOut30d: 2,
    });
    expect(data.strategies.WASTE_FIRST).toEqual({
      priority: 20,
      deadlineUrgency: 20,
      expiryPressure: 60,
    });
    expect(data.rules).toEqual({
      minDaysToDispatch: 1,
      deadlineHorizonDays: 14,
      expiryHorizonDays: 30,
      maxRescores: 3,
    });
  });
});

describe('POST /distribution/proposals', () => {
  it('stores a DRAFT computed by the server, grouped by order, without touching stock', async () => {
    const { riceSoon, riceLater, milkLot, urgent, low, noStock } = seed();

    const res = await create();

    expect(res.statusCode).toBe(201);
    const data = dataOf(res);
    expect(data).toMatchObject({ status: 'DRAFT', strategy: 'BALANCED', businessDate: TODAY });
    expect(data.orders.map((o) => o.orderId)).toEqual([urgent.id, noStock.id, low.id]);
    const [first] = data.orders;
    expect(first).toMatchObject({ rank: 1, fulfillment: 'FULL', code: 'PED-000001' });
    expect(first?.lines.map((l) => [l.productName, l.lotId, l.recommendedQty])).toEqual([
      ['Arroz', riceSoon.id, 10],
      ['Arroz', riceLater.id, 2],
      ['Leche', milkLot.id, 3],
    ]);
    expect(data.orders[1]).toMatchObject({ fulfillment: 'UNSERVED' });
    expect(data.orders[2]?.lines.find((l) => l.productName === 'Leche')).toMatchObject({
      availableQty: 1,
      recommendedQty: 1,
    });
    expect(data.summary).toMatchObject({ ordersFull: 1, ordersPartial: 1, ordersUnserved: 1 });
    expect(data.summary.totalRecommended).toEqual({ KG: 12, L: 4 });
    expect([qty(riceSoon.id), qty(riceLater.id), qty(milkLot.id)]).toEqual([10, 50, 4]);
    expect(auditActions(context).at(-1)).toBe('PROPOSAL_CREATED');
  });

  it('gives a different first order with each strategy', async () => {
    const a = addProduct(context, { name: 'A' });
    const b = addProduct(context, { name: 'B' });
    const c = addProduct(context, { name: 'C' });
    addLot(a.id, 10, 25);
    addLot(b.id, 10, 25);
    addLot(c.id, 10, 1);
    const urgent = addOrder('URGENT', 10, [{ productId: a.id, requestedQty: 1 }]);
    const dueToday = addOrder('LOW', 0, [{ productId: b.id, requestedQty: 1 }]);
    const expiring = addOrder('LOW', 10, [{ productId: c.id, requestedQty: 1 }]);

    const first = async (strategy: string) => dataOf(await create({ strategy })).orders[0]?.orderId;

    expect(await first('BALANCED')).toBe(urgent.id);
    expect(await first('URGENCY_FIRST')).toBe(dueToday.id);
    expect(await first('WASTE_FIRST')).toBe(expiring.id);
  });

  it('stores custom weights that add up to 100', async () => {
    seed();
    const weights = { priority: 50, deadlineUrgency: 25, expiryPressure: 25 };
    expect(dataOf(await create({ strategy: 'BALANCED', weights })).weights).toEqual(weights);
  });

  it('rejects weights that do not add up to 100', async () => {
    const res = await create({
      strategy: 'BALANCED',
      weights: { priority: 50, deadlineUrgency: 30, expiryPressure: 30 },
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { field: 'weights', problem: 'SUM_NOT_100' },
    });
  });

  it('AI_ASSISTED without the AI configured still plans: BALANCED, degraded, NOT_CONFIGURED', async () => {
    seed();
    const balanced = dataOf(await create({ strategy: 'BALANCED' }));
    const res = await create({ strategy: 'AI_ASSISTED' });

    expect(res.statusCode).toBe(201);
    const assisted = dataOf(res);
    expect(assisted).toMatchObject({
      strategy: 'AI_ASSISTED',
      degraded: true,
      aiInsight: null,
      weights: balanced.weights,
      summary: { aiError: 'NOT_CONFIGURED', tieGroups: 0 },
    });
    expect(assisted.orders.map((o) => o.code)).toEqual(balanced.orders.map((o) => o.code));
    expect(assisted.orders[0]?.customerType).toBe('SUPERMARKET');
  });

  it.each([
    ['an unknown strategy', { strategy: 'RANDOM' }],
    ['figures sent by the client', { strategy: 'BALANCED', lines: [] }],
    ['a score sent by the client', { strategy: 'BALANCED', score: 99 }],
  ])('rejects %s with 400', async (_case, body) => {
    expect((await create(body)).statusCode).toBe(400);
  });
});

describe('GET /distribution/proposals', () => {
  it('lists newest first, filters by status and returns 404 for an unknown id', async () => {
    seed();
    const first = dataOf(await create());
    now = new Date(now.getTime() + 60_000);
    const second = dataOf(await create({ strategy: 'WASTE_FIRST' }));
    await call(context.app, context.adminToken, 'POST', `${URL}/proposals/${first.id}/discard`);

    const all = await call(context.app, context.adminToken, 'GET', `${URL}/proposals`);
    const drafts = await call(
      context.app,
      context.adminToken,
      'GET',
      `${URL}/proposals?status=DRAFT`,
    );
    const missing = await call(
      context.app,
      context.adminToken,
      'GET',
      `${URL}/proposals/00000000-0000-4000-8000-000000000000`,
    );

    expect(all.json<{ meta: { total: number } }>().meta.total).toBe(2);
    expect(drafts.json<{ data: { id: string }[] }>().data.map((p) => p.id)).toEqual([second.id]);
    expect(missing.statusCode).toBe(404);
  });
});

describe('POST /distribution/proposals/:id/confirm', () => {
  it('dispatches FEFO, fills allocatedQty and moves served orders to IN_PREPARATION', async () => {
    const { riceSoon, riceLater, milkLot, urgent, low, noStock } = seed();
    const proposal = dataOf(await create());

    const res = await call(
      context.app,
      context.adminToken,
      'POST',
      `${URL}/proposals/${proposal.id}/confirm`,
    );

    expect(res.statusCode).toBe(200);
    expect(dataOf(res)).toMatchObject({ status: 'CONFIRMED', confirmedById: context.admin.id });
    expect([qty(riceSoon.id), qty(riceLater.id), qty(milkLot.id)]).toEqual([0, 48, 0]);
    const dispatches = context.repositories.inventory.movements.filter(
      (m) => m.type === 'EXIT_DISPATCH',
    );
    // Movements of one order are written in item order; compare them as a set.
    const rows = dispatches.map((m) => [m.lotId, m.quantity.toNumber(), m.orderId, m.reason]);
    expect(rows).toHaveLength(4);
    expect(rows).toEqual(
      expect.arrayContaining([
        [riceSoon.id, 10, urgent.id, `proposal:${proposal.id}`],
        [riceLater.id, 2, urgent.id, `proposal:${proposal.id}`],
        [milkLot.id, 3, urgent.id, `proposal:${proposal.id}`],
        [milkLot.id, 1, low.id, `proposal:${proposal.id}`],
      ]),
    );
    const { orders, items, history } = context.repositories.orders;
    expect(orders.get(urgent.id)?.status).toBe('IN_PREPARATION');
    expect(orders.get(low.id)?.status).toBe('IN_PREPARATION');
    expect(orders.get(noStock.id)?.status).toBe('PENDING');
    expect(
      items.filter((i) => i.orderId === urgent.id).map((i) => i.allocatedQty.toNumber()),
    ).toEqual([12, 3]);
    expect(history.filter((h) => h.note === `proposal:${proposal.id}`)).toHaveLength(2);
    expect(auditActions(context).at(-1)).toBe('PROPOSAL_CONFIRMED');
  });

  it('answers 409 when confirmed twice', async () => {
    seed();
    const proposal = dataOf(await create());
    const path = `${URL}/proposals/${proposal.id}/confirm`;
    await call(context.app, context.adminToken, 'POST', path);

    const again = await call(context.app, context.adminToken, 'POST', path);

    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toMatchObject({
      code: 'STALE_PROPOSAL',
      details: { reason: 'NOT_DRAFT' },
    });
  });

  function expectNothingChanged(
    lots: Record<string, number>,
    orderIds: string[],
    proposalId: string,
  ) {
    for (const [lotId, quantity] of Object.entries(lots)) expect(qty(lotId)).toBe(quantity);
    expect(
      context.repositories.inventory.movements.filter((m) => m.type === 'EXIT_DISPATCH'),
    ).toHaveLength(0);
    for (const id of orderIds) {
      expect(['PENDING', 'CANCELLED']).toContain(
        context.repositories.orders.orders.get(id)?.status,
      );
    }
    expect(context.repositories.distribution.proposals.get(proposalId)?.status).toBe('DRAFT');
  }

  it('answers 409 STOCK_CHANGED with the lot when stock moved, and changes nothing', async () => {
    const { rice, riceSoon, riceLater, milkLot, urgent, low } = seed();
    const proposal = dataOf(await create());
    // A waste exit takes part of the rice lot after the plan was made.
    await call(context.app, context.adminToken, 'POST', '/api/v1/inventory/exits', {
      productId: rice.id,
      lotId: riceSoon.id,
      quantity: 4,
      type: 'EXIT_WASTE',
      reason: 'Empaque roto',
    });

    const res = await call(
      context.app,
      context.adminToken,
      'POST',
      `${URL}/proposals/${proposal.id}/confirm`,
    );

    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: 'STALE_PROPOSAL',
      details: { reason: 'STOCK_CHANGED', lotId: riceSoon.id, productId: rice.id },
    });
    expectNothingChanged(
      { [riceSoon.id]: 6, [riceLater.id]: 50, [milkLot.id]: 4 },
      [urgent.id, low.id],
      proposal.id,
    );
  });

  it('answers 409 ORDER_CHANGED when an order was cancelled in between, and changes nothing', async () => {
    const { riceSoon, riceLater, milkLot, urgent, low } = seed();
    const proposal = dataOf(await create());
    await call(context.app, context.adminToken, 'PATCH', `/api/v1/orders/${low.id}/status`, {
      status: 'CANCELLED',
    });

    const res = await call(
      context.app,
      context.adminToken,
      'POST',
      `${URL}/proposals/${proposal.id}/confirm`,
    );

    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toMatchObject({ details: { reason: 'ORDER_CHANGED', orderId: low.id } });
    expectNothingChanged(
      { [riceSoon.id]: 10, [riceLater.id]: 50, [milkLot.id]: 4 },
      [urgent.id],
      proposal.id,
    );
    expect(context.repositories.orders.orders.get(urgent.id)?.status).toBe('PENDING');
  });

  it('answers 409 when another proposal was confirmed first', async () => {
    seed();
    const first = dataOf(await create());
    const second = dataOf(await create({ strategy: 'URGENCY_FIRST' }));
    await call(context.app, context.adminToken, 'POST', `${URL}/proposals/${first.id}/confirm`);

    const res = await call(
      context.app,
      context.adminToken,
      'POST',
      `${URL}/proposals/${second.id}/confirm`,
    );

    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('STALE_PROPOSAL');
  });

  it('answers 409 BUSINESS_DATE_CHANGED for a plan made on another day', async () => {
    seed();
    const proposal = dataOf(await create());
    now = new Date('2026-10-27T15:00:00Z');

    const res = await call(
      context.app,
      context.adminToken,
      'POST',
      `${URL}/proposals/${proposal.id}/confirm`,
    );

    expect(res.statusCode).toBe(409);
    expect(errorOf(res).details).toMatchObject({
      reason: 'BUSINESS_DATE_CHANGED',
      today: '2026-10-27',
    });
  });
});

describe('POST /distribution/proposals/:id/discard', () => {
  it('discards a DRAFT once; a discarded proposal cannot be confirmed', async () => {
    seed();
    const proposal = dataOf(await create());
    const path = `${URL}/proposals/${proposal.id}`;

    const discarded = await call(context.app, context.adminToken, 'POST', `${path}/discard`);
    const again = await call(context.app, context.adminToken, 'POST', `${path}/discard`);
    const confirm = await call(context.app, context.adminToken, 'POST', `${path}/confirm`);

    expect(dataOf(discarded).status).toBe('DISCARDED');
    expect(again.statusCode).toBe(409);
    expect(confirm.statusCode).toBe(409);
    expect(auditActions(context)).toContain('PROPOSAL_DISCARDED');
  });
});
