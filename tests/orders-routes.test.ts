import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OrderDetailDto, OrderDto } from '../src/modules/orders/index.js';
import { buildAuthTestApp, login } from './helpers/auth-fixtures.js';
import {
  addProduct,
  ADMIN,
  buildInventoryTestApp,
  call,
  errorCode,
  type InventoryTestContext,
} from './helpers/inventory-fixtures.js';
import { addCustomer, auditActions } from './helpers/order-fixtures.js';

const URL = '/api/v1/orders';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

let context: InventoryTestContext;

beforeEach(async () => {
  context = await buildInventoryTestApp();
});

afterEach(async () => {
  await context.app.close();
});

function validBody(overrides: Record<string, unknown> = {}) {
  const customer = addCustomer(context);
  const rice = addProduct(context, { name: 'Arroz', unit: 'KG' });
  const milk = addProduct(context, { name: 'Leche', unit: 'L' });
  return {
    customerId: customer.id,
    priority: 'HIGH',
    dueDate: '2026-10-28',
    items: [
      { productId: rice.id, quantity: 12.5 },
      { productId: milk.id, quantity: 30 },
    ],
    ...overrides,
  };
}

const create = (body: unknown, token = context.adminToken) =>
  call(context.app, token, 'POST', URL, body);

describe('orders: roles', () => {
  it('lets only an ADMIN create orders', async () => {
    const res = await create(validBody(), context.operatorToken);
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('lets both roles list and read orders', async () => {
    const { data } = (await create(validBody())).json<{ data: OrderDetailDto }>();
    for (const token of [context.adminToken, context.operatorToken]) {
      expect((await call(context.app, token, 'GET', URL)).statusCode).toBe(200);
      expect((await call(context.app, token, 'GET', `${URL}/${data.id}`)).statusCode).toBe(200);
    }
  });

  it('requires authentication on every route', async () => {
    const responses = await Promise.all([
      context.app.inject({ method: 'GET', url: URL }),
      context.app.inject({ method: 'GET', url: `${URL}/${UNKNOWN_ID}` }),
      context.app.inject({ method: 'POST', url: URL, payload: {} }),
      context.app.inject({ method: 'PATCH', url: `${URL}/${UNKNOWN_ID}/status`, payload: {} }),
    ]);
    expect(responses.map((res) => res.statusCode)).toEqual([401, 401, 401, 401]);
  });
});

describe('POST /orders', () => {
  it('creates a PENDING order with items, the first history row and an audit row', async () => {
    const body = validBody({ notes: 'Entregar en muelle 2' });
    const res = await create(body);

    expect(res.statusCode).toBe(201);
    const { data } = res.json<{ data: OrderDetailDto }>();
    expect(data).toMatchObject({
      code: 'PED-000001',
      number: 1,
      status: 'PENDING',
      priority: 'HIGH',
      dueDate: '2026-10-28',
      notes: 'Entregar en muelle 2',
      itemCount: 2,
      customer: { id: body.customerId, name: 'Supermercado Prueba', type: 'SUPERMARKET' },
      createdById: context.admin.id,
    });
    expect(data.items).toEqual([
      expect.objectContaining({
        productName: 'Arroz',
        unit: 'KG',
        requestedQty: 12.5,
        allocatedQty: 0,
      }),
      expect.objectContaining({
        productName: 'Leche',
        unit: 'L',
        requestedQty: 30,
        allocatedQty: 0,
      }),
    ]);
    expect(data.history).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: 'PENDING', userId: context.admin.id }),
    ]);
    expect(auditActions(context).at(-1)).toBe('ORDER_CREATED');
  });

  it('does not reserve stock: lots and movements stay as they were', async () => {
    const body = validBody();
    const productId = body.items[0]?.productId ?? '';
    context.repositories.inventory.addLot({ productId, quantity: 20, expiryDate: '2026-12-01' });

    await create(body);

    expect([...context.repositories.inventory.lots.values()][0]?.quantity.toNumber()).toBe(20);
    expect(context.repositories.inventory.movements).toHaveLength(0);
  });

  it('numbers orders sequentially', async () => {
    await create(validBody());
    const second = (await create(validBody())).json<{ data: OrderDto }>().data;
    expect(second.code).toBe('PED-000002');
  });

  it('accepts a due date of today in Bogota even when it is already tomorrow in UTC', async () => {
    // 22:00 on 2026-10-26 in Bogota is 03:00 on 2026-10-27 UTC.
    const late = await buildAuthTestApp({ clock: () => new Date('2026-10-27T03:00:00Z') });
    const token = (await login(late.app, ADMIN)).json<{ accessToken: string }>().accessToken;
    const lateContext = { ...context, ...late, adminToken: token };
    const customer = addCustomer(lateContext);
    const product = addProduct(lateContext, { name: 'Panela' });

    const res = await call(late.app, token, 'POST', URL, {
      customerId: customer.id,
      priority: 'LOW',
      dueDate: '2026-10-26',
      items: [{ productId: product.id, quantity: 1 }],
    });

    expect(res.statusCode).toBe(201);
    await late.app.close();
  });

  it('rejects a due date before today (Bogota) with 400', async () => {
    const res = await create(validBody({ dueDate: '2026-10-25' }));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { details: { field: string } } }>().error.details.field).toBe(
      'dueDate',
    );
  });

  it('rejects an unknown customer with 404 and an inactive one with 400', async () => {
    const unknown = await create(validBody({ customerId: UNKNOWN_ID }));
    const inactive = addCustomer(context, { status: 'INACTIVE' });
    const res = await create(validBody({ customerId: inactive.id }));

    expect(unknown.statusCode).toBe(404);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown product with 404 and an inactive one with 400', async () => {
    const body = validBody();
    const inactive = addProduct(context, { name: 'Descontinuado', status: 'INACTIVE' });
    const unknown = await create({ ...body, items: [{ productId: UNKNOWN_ID, quantity: 1 }] });
    const res = await create({ ...body, items: [{ productId: inactive.id, quantity: 1 }] });

    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<{ error: { details: unknown } }>().error.details).toEqual({
      productIds: [UNKNOWN_ID],
    });
    expect(res.statusCode).toBe(400);
    expect(context.repositories.orders.orders.size).toBe(0);
  });

  it.each([
    [
      'a repeated product',
      (b: ReturnType<typeof validBody>) => ({
        ...b,
        items: [b.items[0], b.items[0]],
      }),
    ],
    ['no items', (b: ReturnType<typeof validBody>) => ({ ...b, items: [] })],
    [
      'a zero quantity',
      (b: ReturnType<typeof validBody>) => ({
        ...b,
        items: [{ productId: b.items[0]?.productId, quantity: 0 }],
      }),
    ],
    [
      'four decimals',
      (b: ReturnType<typeof validBody>) => ({
        ...b,
        items: [{ productId: b.items[0]?.productId, quantity: 1.2345 }],
      }),
    ],
    [
      'a quantity as text',
      (b: ReturnType<typeof validBody>) => ({
        ...b,
        items: [{ productId: b.items[0]?.productId, quantity: '5' }],
      }),
    ],
    [
      'an allocatedQty sent by the client',
      (b: ReturnType<typeof validBody>) => ({
        ...b,
        items: [{ productId: b.items[0]?.productId, quantity: 5, allocatedQty: 5 }],
      }),
    ],
    ['an invalid date', (b: ReturnType<typeof validBody>) => ({ ...b, dueDate: '2026-02-30' })],
    ['an unknown priority', (b: ReturnType<typeof validBody>) => ({ ...b, priority: 'ASAP' })],
    [
      'a status sent by the client',
      (b: ReturnType<typeof validBody>) => ({
        ...b,
        status: 'SHIPPED',
      }),
    ],
  ])('rejects %s with 400 and stores nothing', async (_case, change) => {
    const res = await create(change(validBody()));
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
    expect(context.repositories.orders.orders.size).toBe(0);
  });
});

describe('GET /orders', () => {
  function seedOrders() {
    const { orders } = context.repositories;
    const a = addCustomer(context, { name: 'Cliente A' });
    const b = addCustomer(context, { name: 'Cliente B' });
    const at = (date: string) => new Date(`${date}T00:00:00.000Z`);
    const by = context.admin.id;
    return {
      a,
      late: orders.addOrder({
        customerId: a.id,
        createdById: by,
        dueDate: at('2026-11-10'),
        priority: 'LOW',
      }),
      urgent: orders.addOrder({
        customerId: b.id,
        createdById: by,
        dueDate: at('2026-10-27'),
        priority: 'URGENT',
      }),
      low: orders.addOrder({
        customerId: a.id,
        createdById: by,
        dueDate: at('2026-10-27'),
        priority: 'LOW',
      }),
      shipped: orders.addOrder({
        customerId: b.id,
        createdById: by,
        dueDate: at('2026-10-26'),
        status: 'SHIPPED',
      }),
    };
  }

  const codes = async (query = '') =>
    (await call(context.app, context.operatorToken, 'GET', `${URL}${query}`))
      .json<{ data: OrderDto[] }>()
      .data.map((o) => o.number);

  it('orders by due date, then priority with URGENT first', async () => {
    const { late, urgent, low, shipped } = seedOrders();
    expect(await codes()).toEqual([shipped.number, urgent.number, low.number, late.number]);
  });

  it('filters by several statuses, comma separated or repeated', async () => {
    const { late, urgent, low, shipped } = seedOrders();
    const pending = [urgent.number, low.number, late.number];
    expect(await codes('?status=PENDING')).toEqual(pending);
    expect(await codes('?status=PENDING,SHIPPED')).toEqual([shipped.number, ...pending]);
    expect(await codes('?status=PENDING&status=SHIPPED')).toEqual([shipped.number, ...pending]);
  });

  it('filters by priority, customer and dueBefore (exclusive)', async () => {
    const { a, late, urgent, low, shipped } = seedOrders();
    expect(await codes('?priority=URGENT')).toEqual([urgent.number]);
    expect(await codes(`?customerId=${a.id}`)).toEqual([low.number, late.number]);
    expect(await codes('?dueBefore=2026-10-27')).toEqual([shipped.number]);
  });

  it('paginates with meta.total and includes the customer and item count', async () => {
    seedOrders();
    const res = await call(context.app, context.adminToken, 'GET', `${URL}?pageSize=2&page=2`);
    const body = res.json<{ data: OrderDto[]; meta: { total: number } }>();
    expect(body.meta.total).toBe(4);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({ customer: { name: 'Cliente A' }, itemCount: 0 });
  });

  it('rejects an unknown status with 400', async () => {
    const res = await call(context.app, context.adminToken, 'GET', `${URL}?status=PENDING,LOST`);
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown order', async () => {
    const res = await call(context.app, context.adminToken, 'GET', `${URL}/${UNKNOWN_ID}`);
    expect(res.statusCode).toBe(404);
  });
});
