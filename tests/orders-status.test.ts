import type { OrderStatus } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OrderDetailDto } from '../src/modules/orders/index.js';
import {
  addProduct,
  buildInventoryTestApp,
  call,
  errorCode,
  type InventoryTestContext,
} from './helpers/inventory-fixtures.js';
import { addCustomer, auditActions } from './helpers/order-fixtures.js';

let context: InventoryTestContext;

beforeEach(async () => {
  context = await buildInventoryTestApp();
});

afterEach(async () => {
  await context.app.close();
});

function addOrder(status: OrderStatus, lines: { productId: string; requestedQty: number }[] = []) {
  const customer = addCustomer(context);
  return context.repositories.orders.addOrder(
    { customerId: customer.id, createdById: context.admin.id, status },
    lines,
  );
}

const patch = (id: string, body: unknown, token = context.adminToken) =>
  call(context.app, token, 'PATCH', `/api/v1/orders/${id}/status`, body);

const reasonOf = (res: LightMyRequestResponse) =>
  res.json<{ error: { details: { reason: string } } }>().error.details.reason;

describe('PATCH /orders/:id/status: state machine', () => {
  it.each([
    ['IN_PREPARATION', 'READY_FOR_DISPATCH'],
    ['READY_FOR_DISPATCH', 'SHIPPED'],
    ['SHIPPED', 'DELIVERED'],
  ] as const)('lets an OPERATOR move %s -> %s and records history and audit', async (from, to) => {
    const order = addOrder(from);

    const res = await patch(order.id, { status: to, note: 'Revisado' }, context.operatorToken);

    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: OrderDetailDto }>();
    expect(data.status).toBe(to);
    expect(data.history.at(-1)).toMatchObject({
      fromStatus: from,
      toStatus: to,
      note: 'Revisado',
      userId: context.operator.id,
    });
    expect(auditActions(context).at(-1)).toBe('ORDER_STATUS_CHANGED');
  });

  it('rejects PENDING -> IN_PREPARATION: only confirming a proposal does that', async () => {
    const order = addOrder('PENDING');
    const res = await patch(order.id, { status: 'IN_PREPARATION' });

    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('INVALID_STATUS_TRANSITION');
    expect(reasonOf(res)).toBe('REQUIRES_PROPOSAL');
  });

  it.each([
    ['PENDING', 'SHIPPED'],
    ['IN_PREPARATION', 'PENDING'],
    ['SHIPPED', 'CANCELLED'],
    ['DELIVERED', 'SHIPPED'],
    ['CANCELLED', 'PENDING'],
    ['READY_FOR_DISPATCH', 'READY_FOR_DISPATCH'],
  ] as const)('rejects %s -> %s with 409 and changes nothing', async (from, to) => {
    const order = addOrder(from);

    const res = await patch(order.id, { status: to });

    expect(res.statusCode).toBe(409);
    expect(reasonOf(res)).toBe('NOT_ALLOWED');
    expect(context.repositories.orders.orders.get(order.id)?.status).toBe(from);
  });

  it('rejects a cancellation by an OPERATOR with 403', async () => {
    const order = addOrder('PENDING');
    const res = await patch(order.id, { status: 'CANCELLED' }, context.operatorToken);

    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(context.repositories.orders.orders.get(order.id)?.status).toBe('PENDING');
  });

  it('answers 404 for an unknown order and 400 for an unknown status', async () => {
    const order = addOrder('PENDING');
    const unknown = await patch('00000000-0000-4000-8000-000000000000', { status: 'CANCELLED' });
    const invalid = await patch(order.id, { status: 'LOST' });
    expect([unknown.statusCode, invalid.statusCode]).toEqual([404, 400]);
  });
});

describe('PATCH /orders/:id/status: cancellation', () => {
  it('cancels a PENDING order without movements', async () => {
    const order = addOrder('PENDING');

    const res = await patch(order.id, { status: 'CANCELLED', note: 'Cliente desistió' });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: OrderDetailDto }>().data.status).toBe('CANCELLED');
    expect(context.repositories.inventory.movements).toHaveLength(0);
  });

  it('returns every dispatched quantity to its own lot with RETURN movements', async () => {
    const { inventory } = context.repositories;
    const rice = addProduct(context, { name: 'Arroz' });
    const milk = addProduct(context, { name: 'Leche', unit: 'L' });
    const order = addOrder('IN_PREPARATION', [
      { productId: rice.id, requestedQty: 10.5 },
      { productId: milk.id, requestedQty: 4 },
    ]);
    for (const item of context.repositories.orders.items) item.allocatedQty = item.requestedQty;
    // Lots after the proposal was confirmed: 8 + 2.5 of rice and 4 of milk left.
    const riceA = inventory.addLot({ productId: rice.id, quantity: 0, expiryDate: '2026-11-01' });
    const riceB = inventory.addLot({ productId: rice.id, quantity: 7.5, expiryDate: '2026-12-01' });
    const milkLot = inventory.addLot({ productId: milk.id, quantity: 1, expiryDate: '2026-10-30' });
    const dispatch = (lotId: string, quantity: number) => {
      inventory.addMovement({
        lotId,
        type: 'EXIT_DISPATCH',
        quantity,
        reason: null,
        orderId: order.id,
        userId: context.admin.id,
        createdAt: new Date('2026-10-25T15:00:00Z'),
      });
    };
    dispatch(riceA.id, 8);
    dispatch(riceB.id, 2.5);
    dispatch(milkLot.id, 4);

    const res = await patch(order.id, { status: 'CANCELLED', note: 'Pedido duplicado' });

    expect(res.statusCode).toBe(200);
    const quantity = (id: string) => inventory.lots.get(id)?.quantity.toNumber();
    expect([quantity(riceA.id), quantity(riceB.id), quantity(milkLot.id)]).toEqual([8, 10, 5]);
    const returns = inventory.movements.filter((m) => m.type === 'RETURN');
    expect(returns.map((m) => [m.lotId, m.quantity.toNumber(), m.orderId]).sort()).toEqual(
      [
        [riceA.id, 8, order.id],
        [riceB.id, 2.5, order.id],
        [milkLot.id, 4, order.id],
      ].sort(),
    );
    const { data } = res.json<{ data: OrderDetailDto }>();
    expect(data.items.map((item) => item.allocatedQty)).toEqual([0, 0]);
    expect(context.repositories.auditLogs.entries.at(-1)?.metadata).toMatchObject({
      from: 'IN_PREPARATION',
      to: 'CANCELLED',
      returnedLots: 3,
    });
  });

  it('only returns what was not returned before', async () => {
    const { inventory } = context.repositories;
    const rice = addProduct(context, { name: 'Arroz' });
    const order = addOrder('READY_FOR_DISPATCH');
    const lot = inventory.addLot({ productId: rice.id, quantity: 3, expiryDate: '2026-11-01' });
    const base = { lotId: lot.id, reason: null, orderId: order.id, userId: context.admin.id };
    inventory.addMovement({ ...base, type: 'EXIT_DISPATCH', quantity: 5, createdAt: new Date() });
    inventory.addMovement({ ...base, type: 'RETURN', quantity: 2, createdAt: new Date() });

    await patch(order.id, { status: 'CANCELLED' });

    expect(inventory.lots.get(lot.id)?.quantity.toNumber()).toBe(6);
  });
});

describe('PATCH /orders/:id/status: concurrent changes', () => {
  /** Another request changes the status right after this one read the order. */
  function changeAfterRead(orderId: string, to: OrderStatus) {
    const { orders } = context.repositories;
    const read = orders.findById.bind(orders);
    orders.findById = async (id) => {
      const order = await read(id);
      const current = orders.orders.get(orderId);
      if (current) orders.orders.set(orderId, { ...current, status: to });
      return order;
    };
  }

  it('answers 409 when another user changed the status first', async () => {
    const order = addOrder('IN_PREPARATION');
    changeAfterRead(order.id, 'CANCELLED');

    const res = await patch(order.id, { status: 'READY_FOR_DISPATCH' }, context.operatorToken);

    expect(res.statusCode).toBe(409);
    expect(reasonOf(res)).toBe('STATUS_CHANGED');
    expect(context.repositories.orders.orders.get(order.id)?.status).toBe('CANCELLED');
    expect(context.repositories.orders.history).toHaveLength(0);
  });

  it('writes no RETURN and restores nothing when a cancellation loses the race', async () => {
    const { inventory } = context.repositories;
    const rice = addProduct(context, { name: 'Arroz' });
    const order = addOrder('READY_FOR_DISPATCH', [{ productId: rice.id, requestedQty: 5 }]);
    const lot = inventory.addLot({ productId: rice.id, quantity: 1, expiryDate: '2026-11-01' });
    inventory.addMovement({
      lotId: lot.id,
      type: 'EXIT_DISPATCH',
      quantity: 5,
      reason: null,
      orderId: order.id,
      userId: context.admin.id,
      createdAt: new Date(),
    });
    changeAfterRead(order.id, 'SHIPPED');

    const res = await patch(order.id, { status: 'CANCELLED' });

    expect(res.statusCode).toBe(409);
    expect(inventory.lots.get(lot.id)?.quantity.toNumber()).toBe(1);
    expect(inventory.movements.filter((m) => m.type === 'RETURN')).toHaveLength(0);
    expect(auditActions(context)).not.toContain('ORDER_STATUS_CHANGED');
  });
});
