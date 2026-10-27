import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Alert } from '../src/modules/alerts/index.js';
import {
  addProduct,
  buildInventoryTestApp,
  call,
  NOW,
  type InventoryTestContext,
} from './helpers/inventory-fixtures.js';
import { addCustomer } from './helpers/order-fixtures.js';

const URL = '/api/v1/alerts';

let context: InventoryTestContext;

beforeEach(async () => {
  context = await buildInventoryTestApp();
});

afterEach(async () => {
  await context.app.close();
});

const at = (date: string) => new Date(`${date}T00:00:00.000Z`);

async function alerts(token = context.adminToken): Promise<Alert[]> {
  const res = await call(context.app, token, 'GET', URL);
  expect(res.statusCode).toBe(200);
  return res.json<{ data: Alert[] }>().data;
}

function dispatched(lotId: string, quantity: number) {
  context.repositories.inventory.addMovement({
    lotId,
    type: 'EXIT_DISPATCH',
    quantity,
    reason: null,
    orderId: null,
    userId: context.admin.id,
    createdAt: new Date(NOW.getTime() - 5 * 86_400_000),
  });
}

describe('GET /alerts', () => {
  it('requires authentication and lets both roles read alerts', async () => {
    expect((await context.app.inject({ method: 'GET', url: URL })).statusCode).toBe(401);
    expect(await alerts(context.operatorToken)).toEqual([]);
  });

  it('computes every alert type from live stock, outflow and orders', async () => {
    const { inventory, orders } = context.repositories;
    const customer = addCustomer(context);
    const by = { customerId: customer.id, createdById: context.admin.id };

    // LOW_STOCK (WARNING) and SHORTAGE_RISK: 4 left, minimum 10, 9 requested.
    const lentils = addProduct(context, { name: 'Lenteja', minStock: 10 });
    dispatched(
      inventory.addLot({ productId: lentils.id, quantity: 4, expiryDate: '2027-06-01' }).id,
      60,
    );
    // LOW_STOCK (CRITICAL): nothing left.
    const tilapia = addProduct(context, { name: 'Tilapia', minStock: 5 });
    // EXPIRING_SOON (CRITICAL, 1 day) with fast rotation: no waste risk.
    const milk = addProduct(context, { name: 'Leche', minStock: 5 });
    dispatched(
      inventory.addLot({ productId: milk.id, quantity: 20, expiryDate: '2026-10-27' }).id,
      900,
    );
    // WASTE_RISK (CRITICAL): 50 units at 1/day expire in 20 days.
    const cheese = addProduct(context, { name: 'Queso', minStock: 5 });
    dispatched(
      inventory.addLot({ productId: cheese.id, quantity: 50, expiryDate: '2026-11-15' }).id,
      30,
    );
    // Inactive products raise nothing.
    addProduct(context, { name: 'Descontinuado', minStock: 100, status: 'INACTIVE' });

    const due = orders.addOrder({ ...by, dueDate: at('2026-10-27') }, [
      { productId: lentils.id, requestedQty: 9 },
    ]);
    const overdue = orders.addOrder({ ...by, dueDate: at('2026-10-24'), status: 'IN_PREPARATION' });
    orders.addOrder({ ...by, dueDate: at('2026-10-20'), status: 'DELIVERED' });
    orders.addOrder({ ...by, dueDate: at('2026-11-20') });

    const result = await alerts();

    expect(result.map((a) => [a.type, a.severity, a.entityId])).toEqual([
      ['LOW_STOCK', 'CRITICAL', tilapia.id],
      ['EXPIRING_SOON', 'CRITICAL', milk.id],
      ['WASTE_RISK', 'CRITICAL', cheese.id],
      ['ORDER_DUE_SOON', 'CRITICAL', overdue.id],
      ['LOW_STOCK', 'WARNING', lentils.id],
      ['SHORTAGE_RISK', 'WARNING', lentils.id],
      ['ORDER_DUE_SOON', 'WARNING', due.id],
    ]);
    expect(result.find((a) => a.type === 'SHORTAGE_RISK')?.params).toEqual({
      name: 'Lenteja',
      demand: 9,
      available: 4,
    });
    expect(result.find((a) => a.entityId === overdue.id)?.params).toEqual({
      orderCode: 'PED-000002',
      daysOverdue: 2,
    });
  });

  it('counts only PENDING orders as demand', async () => {
    const { inventory, orders } = context.repositories;
    const customer = addCustomer(context);
    const rice = addProduct(context, { name: 'Arroz', minStock: 1 });
    dispatched(
      inventory.addLot({ productId: rice.id, quantity: 10, expiryDate: '2027-06-01' }).id,
      30,
    );
    orders.addOrder(
      { customerId: customer.id, createdById: context.admin.id, status: 'CANCELLED' },
      [{ productId: rice.id, requestedQty: 50 }],
    );
    orders.addOrder({ customerId: customer.id, createdById: context.admin.id }, [
      { productId: rice.id, requestedQty: 10 },
    ]);

    expect((await alerts()).filter((a) => a.type === 'SHORTAGE_RISK')).toEqual([]);
  });
});
