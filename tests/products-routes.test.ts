import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProductDto } from '../src/modules/products/product.dto.js';
import {
  addProduct,
  buildInventoryTestApp,
  call,
  errorCode,
  type InventoryTestContext,
} from './helpers/inventory-fixtures.js';

let ctx: InventoryTestContext;

beforeEach(async () => {
  ctx = await buildInventoryTestApp();
});

afterEach(async () => {
  await ctx.app.close();
});

const validProduct = { name: 'Arroz blanco', category: 'GRAINS_LEGUMES', unit: 'KG', minStock: 50 };

describe('roles', () => {
  it('requires authentication to list products', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/products' });

    expect(res.statusCode).toBe(401);
  });

  it('lets an OPERATOR read products', async () => {
    addProduct(ctx, { name: 'Leche entera' });

    const res = await call(ctx.app, ctx.operatorToken, 'GET', '/api/v1/products');

    expect(res.statusCode).toBe(200);
  });

  it('returns 403 FORBIDDEN to an OPERATOR on POST and PATCH', async () => {
    const product = addProduct(ctx, { name: 'Leche entera' });

    const created = await call(
      ctx.app,
      ctx.operatorToken,
      'POST',
      '/api/v1/products',
      validProduct,
    );
    const patched = await call(
      ctx.app,
      ctx.operatorToken,
      'PATCH',
      `/api/v1/products/${product.id}`,
      {
        minStock: 1,
      },
    );

    for (const res of [created, patched]) {
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('FORBIDDEN');
    }
    expect(ctx.repositories.products.products.size).toBe(1);
  });

  it('has no physical delete', async () => {
    const product = addProduct(ctx, { name: 'Leche entera' });

    const res = await call(ctx.app, ctx.adminToken, 'DELETE', `/api/v1/products/${product.id}`);

    expect(res.statusCode).toBe(404);
    expect(ctx.repositories.products.products.has(product.id)).toBe(true);
  });
});

describe('POST /api/v1/products', () => {
  it('creates the product (201) with computed fields, decimals as numbers and an audit row', async () => {
    const res = await call(ctx.app, ctx.adminToken, 'POST', '/api/v1/products', {
      ...validProduct,
      minStock: 12.5,
    });

    expect(res.statusCode).toBe(201);
    const { data } = res.json<{ data: ProductDto }>();
    expect(data).toMatchObject({
      name: 'Arroz blanco',
      minStock: 12.5,
      status: 'ACTIVE',
      availableQty: 0,
      stockStatus: 'OUT',
      wasteRisk: 'NONE',
      coverageDays: null,
    });
    expect(typeof data.minStock).toBe('number');
    expect(ctx.repositories.auditLogs.entries).toContainEqual(
      expect.objectContaining({
        action: 'PRODUCT_CREATED',
        entity: 'Product',
        entityId: data.id,
        userId: ctx.admin.id,
      }),
    );
  });

  it.each([
    ['missing fields', { name: 'Arroz' }],
    ['empty name', { ...validProduct, name: '   ' }],
    ['negative minStock', { ...validProduct, minStock: -1 }],
    ['minStock with 4 decimals', { ...validProduct, minStock: 1.0005 }],
    ['minStock as a string', { ...validProduct, minStock: '10' }],
    ['unknown category', { ...validProduct, category: 'TOYS' }],
    ['unknown unit', { ...validProduct, unit: 'LB' }],
    ['a computed field sent by the client', { ...validProduct, availableQty: 999 }],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_label, body) => {
    const res = await call(ctx.app, ctx.adminToken, 'POST', '/api/v1/products', body);

    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
    expect(ctx.repositories.products.products.size).toBe(0);
  });

  it('returns 409 DUPLICATE for an existing name, ignoring case and spaces', async () => {
    addProduct(ctx, { name: 'Arroz blanco' });

    const res = await call(ctx.app, ctx.adminToken, 'POST', '/api/v1/products', {
      ...validProduct,
      name: '  ARROZ BLANCO ',
    });

    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('DUPLICATE');
    expect(ctx.repositories.products.products.size).toBe(1);
  });
});
