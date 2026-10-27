import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CustomerDto } from '../src/modules/customers/index.js';
import {
  buildInventoryTestApp,
  call,
  errorCode,
  type InventoryTestContext,
} from './helpers/inventory-fixtures.js';
import { addCustomer } from './helpers/order-fixtures.js';

const URL = '/api/v1/customers';
const VALID = {
  name: 'Restaurante El Fogón',
  type: 'RESTAURANT',
  address: 'Calle 85 # 12-30, Bogotá',
  phone: '+57 601 345 6789',
  email: 'Compras@ElFogon.test',
};

let context: InventoryTestContext;

beforeEach(async () => {
  context = await buildInventoryTestApp();
});

afterEach(async () => {
  await context.app.close();
});

describe('customers: roles', () => {
  it('rejects every route for an OPERATOR with 403', async () => {
    const { app, operatorToken } = context;
    const customer = addCustomer(context);
    const responses = await Promise.all([
      call(app, operatorToken, 'GET', URL),
      call(app, operatorToken, 'GET', `${URL}/${customer.id}`),
      call(app, operatorToken, 'POST', URL, VALID),
      call(app, operatorToken, 'PATCH', `${URL}/${customer.id}`, { name: 'Otro' }),
    ]);
    expect(responses.map((res) => res.statusCode)).toEqual([403, 403, 403, 403]);
  });

  it('requires authentication', async () => {
    const res = await context.app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(401);
  });

  it('has no DELETE route: customers are deactivated', async () => {
    const customer = addCustomer(context);
    const res = await call(context.app, context.adminToken, 'DELETE', `${URL}/${customer.id}`);
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /customers', () => {
  it('creates an active customer with a lowercased email and an audit row without personal data', async () => {
    const res = await call(context.app, context.adminToken, 'POST', URL, VALID);

    expect(res.statusCode).toBe(201);
    const { data } = res.json<{ data: CustomerDto }>();
    expect(data).toMatchObject({
      name: 'Restaurante El Fogón',
      type: 'RESTAURANT',
      email: 'compras@elfogon.test',
      phone: '+57 601 345 6789',
      status: 'ACTIVE',
    });
    const audit = context.repositories.auditLogs.entries.at(-1);
    expect(audit).toMatchObject({ action: 'CUSTOMER_CREATED', entityId: data.id });
    expect(JSON.stringify(audit?.metadata)).not.toContain('elfogon');
  });

  it('stores missing phone and email as null', async () => {
    const res = await call(context.app, context.adminToken, 'POST', URL, {
      name: 'Banco de Alimentos Norte',
      type: 'FOOD_BANK',
      address: 'Av 68 # 20-10',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ data: CustomerDto }>().data).toMatchObject({ phone: null, email: null });
  });

  it.each([
    ['a missing address', { ...VALID, address: undefined }],
    ['an unknown type', { ...VALID, type: 'BAR' }],
    ['an invalid email', { ...VALID, email: 'no-at-sign' }],
    ['an invalid phone', { ...VALID, phone: 'llamar' }],
    ['a status on creation', { ...VALID, status: 'INACTIVE' }],
    ['an empty name', { ...VALID, name: '   ' }],
  ])('rejects %s with 400', async (_case, body) => {
    const res = await call(context.app, context.adminToken, 'POST', URL, body);
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
  });
});

describe('GET and PATCH /customers/:id', () => {
  it('returns a customer and 404 for an unknown one', async () => {
    const customer = addCustomer(context, { name: 'Colegio San Martín', type: 'SCHOOL' });
    const found = await call(context.app, context.adminToken, 'GET', `${URL}/${customer.id}`);
    const missing = await call(
      context.app,
      context.adminToken,
      'GET',
      `${URL}/00000000-0000-4000-8000-000000000000`,
    );

    expect(found.json<{ data: CustomerDto }>().data.name).toBe('Colegio San Martín');
    expect(missing.statusCode).toBe(404);
    expect(errorCode(missing)).toBe('NOT_FOUND');
  });

  it('deactivates a customer and clears the phone with null', async () => {
    const customer = addCustomer(context);
    context.repositories.customers.customers.set(customer.id, { ...customer, phone: '3001234567' });

    const res = await call(context.app, context.adminToken, 'PATCH', `${URL}/${customer.id}`, {
      status: 'INACTIVE',
      phone: null,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: CustomerDto }>().data).toMatchObject({
      status: 'INACTIVE',
      phone: null,
    });
    expect(context.repositories.auditLogs.entries.at(-1)).toMatchObject({
      action: 'CUSTOMER_UPDATED',
      metadata: { fields: ['phone', 'status'], status: 'INACTIVE' },
    });
  });

  it('rejects an empty patch with 400 and an unknown customer with 404', async () => {
    const customer = addCustomer(context);
    const empty = await call(context.app, context.adminToken, 'PATCH', `${URL}/${customer.id}`, {});
    const unknown = await call(
      context.app,
      context.adminToken,
      'PATCH',
      `${URL}/00000000-0000-4000-8000-000000000000`,
      { name: 'Otro' },
    );
    expect(empty.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(404);
  });
});

describe('GET /customers', () => {
  it('filters by search, type and status and paginates by name', async () => {
    addCustomer(context, { name: 'Hospital San José', type: 'HOSPITAL' });
    addCustomer(context, { name: 'Hospital Central', type: 'HOSPITAL', status: 'INACTIVE' });
    addCustomer(context, { name: 'Colegio Los Andes', type: 'SCHOOL' });
    const list = async (query: string) =>
      (await call(context.app, context.adminToken, 'GET', `${URL}?${query}`)).json<{
        data: CustomerDto[];
        meta: { total: number };
      }>();

    expect((await list('type=HOSPITAL')).data.map((c) => c.name)).toEqual([
      'Hospital Central',
      'Hospital San José',
    ]);
    expect((await list('type=HOSPITAL&status=ACTIVE')).data.map((c) => c.name)).toEqual([
      'Hospital San José',
    ]);
    expect((await list('search=andes')).data.map((c) => c.name)).toEqual(['Colegio Los Andes']);
    const page = await list('page=2&pageSize=2');
    expect(page.meta.total).toBe(3);
    expect(page.data.map((c) => c.name)).toEqual(['Hospital San José']);
  });

  it('rejects an unknown filter value with 400', async () => {
    const res = await call(context.app, context.adminToken, 'GET', `${URL}?type=BAR`);
    expect(res.statusCode).toBe(400);
  });
});
