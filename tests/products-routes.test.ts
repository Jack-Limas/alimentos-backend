import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailDto, ProductDto } from '../src/modules/products/product.dto.js';
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

describe('PATCH /api/v1/products/:id', () => {
  it('updates fields and deactivates instead of deleting', async () => {
    const product = addProduct(ctx, { name: 'Pan tajado', minStock: 10 });

    const res = await call(ctx.app, ctx.adminToken, 'PATCH', `/api/v1/products/${product.id}`, {
      minStock: 20,
      status: 'INACTIVE',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: ProductDto }>().data).toMatchObject({
      minStock: 20,
      status: 'INACTIVE',
    });
    expect(ctx.repositories.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'PRODUCT_UPDATED', entityId: product.id }),
    );
  });

  it('allows keeping the same name with different case', async () => {
    const product = addProduct(ctx, { name: 'Pan tajado' });

    const res = await call(ctx.app, ctx.adminToken, 'PATCH', `/api/v1/products/${product.id}`, {
      name: 'Pan Tajado',
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 409 DUPLICATE when renaming to another product name', async () => {
    addProduct(ctx, { name: 'Pan tajado' });
    const other = addProduct(ctx, { name: 'Pan integral' });

    const res = await call(ctx.app, ctx.adminToken, 'PATCH', `/api/v1/products/${other.id}`, {
      name: 'pan tajado',
    });

    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('DUPLICATE');
  });

  it('returns 404 for an unknown product and 400 for an empty or invalid body', async () => {
    const product = addProduct(ctx, { name: 'Pan tajado' });

    const missing = await call(
      ctx.app,
      ctx.adminToken,
      'PATCH',
      '/api/v1/products/2f1c9b1e-0000-4000-8000-000000000000',
      { minStock: 1 },
    );
    const empty = await call(
      ctx.app,
      ctx.adminToken,
      'PATCH',
      `/api/v1/products/${product.id}`,
      {},
    );
    const badStatus = await call(
      ctx.app,
      ctx.adminToken,
      'PATCH',
      `/api/v1/products/${product.id}`,
      {
        status: 'DELETED',
      },
    );

    expect(missing.statusCode).toBe(404);
    expect(empty.statusCode).toBe(400);
    expect(badStatus.statusCode).toBe(400);
  });
});

describe('GET /api/v1/products', () => {
  function seedCatalog() {
    const rice = addProduct(ctx, { name: 'Arroz blanco', minStock: 50 });
    const milk = addProduct(ctx, {
      name: 'Leche entera',
      category: 'DAIRY',
      unit: 'L',
      minStock: 10,
    });
    const beans = addProduct(ctx, { name: 'Fríjol rojo', minStock: 5 });
    const inventory = ctx.repositories.inventory;
    inventory.addLot({ productId: rice.id, quantity: 20, expiryDate: '2027-06-01' });
    inventory.addLot({ productId: milk.id, quantity: 12.5, expiryDate: '2026-10-29' });
    inventory.addLot({ productId: milk.id, quantity: 7.25, expiryDate: '2026-11-15' });
    return { rice, milk, beans };
  }

  it('returns metrics for each product with decimals as numbers', async () => {
    const { milk } = seedCatalog();

    const res = await call(ctx.app, ctx.adminToken, 'GET', '/api/v1/products');

    const body = res.json<{ data: ProductDto[]; meta: unknown }>();
    expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 3 });
    const dto = body.data.find((p) => p.id === milk.id);
    expect(dto).toMatchObject({
      availableQty: 19.75,
      nearestExpiry: '2026-10-29',
      daysToNearestExpiry: 3,
      stockStatus: 'OK',
      wasteRisk: 'HIGH',
    });
    expect(typeof dto?.availableQty).toBe('number');
  });

  it('filters by stockStatus', async () => {
    const { rice, beans } = seedCatalog();

    const low = await call(ctx.app, ctx.adminToken, 'GET', '/api/v1/products?stockStatus=LOW');
    const out = await call(ctx.app, ctx.adminToken, 'GET', '/api/v1/products?stockStatus=OUT');

    expect(low.json<{ data: ProductDto[] }>().data.map((p) => p.id)).toEqual([rice.id]);
    expect(out.json<{ data: ProductDto[] }>().data.map((p) => p.id)).toEqual([beans.id]);
    expect(low.json<{ meta: { total: number } }>().meta.total).toBe(1);
  });

  it('filters by wasteRisk computed from the metrics, and rejects unknown values', async () => {
    const { milk, rice, beans } = seedCatalog();

    const high = await call(ctx.app, ctx.adminToken, 'GET', '/api/v1/products?wasteRisk=HIGH');
    const none = await call(ctx.app, ctx.adminToken, 'GET', '/api/v1/products?wasteRisk=NONE');
    const bad = await call(ctx.app, ctx.adminToken, 'GET', '/api/v1/products?wasteRisk=MAX');

    expect(high.json<{ data: ProductDto[] }>().data.map((p) => p.id)).toEqual([milk.id]);
    expect(
      none
        .json<{ data: ProductDto[] }>()
        .data.map((p) => p.id)
        .sort(),
    ).toEqual([rice.id, beans.id].sort());
    expect(bad.statusCode).toBe(400);
  });

  it('filters by expiringWithinDays', async () => {
    const { milk } = seedCatalog();

    const res = await call(ctx.app, ctx.adminToken, 'GET', '/api/v1/products?expiringWithinDays=7');

    expect(res.json<{ data: ProductDto[] }>().data.map((p) => p.id)).toEqual([milk.id]);
  });

  it('filters by search, category and status, and paginates', async () => {
    seedCatalog();

    const search = await call(ctx.app, ctx.adminToken, 'GET', '/api/v1/products?search=LECHE');
    const category = await call(ctx.app, ctx.adminToken, 'GET', '/api/v1/products?category=DAIRY');
    const page = await call(ctx.app, ctx.adminToken, 'GET', '/api/v1/products?page=2&pageSize=2');

    expect(search.json<{ data: ProductDto[] }>().data).toHaveLength(1);
    expect(category.json<{ data: ProductDto[] }>().data).toHaveLength(1);
    expect(page.json<{ data: ProductDto[]; meta: unknown }>()).toMatchObject({
      meta: { page: 2, pageSize: 2, total: 3 },
    });
    expect(page.json<{ data: ProductDto[] }>().data).toHaveLength(1);
  });

  it('rejects invalid filters with 400', async () => {
    const res = await call(ctx.app, ctx.adminToken, 'GET', '/api/v1/products?stockStatus=EMPTY');

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/products/:id', () => {
  it('includes the lots with stock ordered by expiry date', async () => {
    const product = addProduct(ctx, { name: 'Queso campesino', category: 'DAIRY', minStock: 2 });
    const inventory = ctx.repositories.inventory;
    inventory.addLot({
      productId: product.id,
      quantity: 3,
      expiryDate: '2026-11-20',
      lotCode: 'B',
    });
    inventory.addLot({
      productId: product.id,
      quantity: 1.5,
      expiryDate: '2026-11-02',
      lotCode: 'A',
    });
    inventory.addLot({
      productId: product.id,
      quantity: 0,
      expiryDate: '2026-10-30',
      lotCode: 'EMPTY',
    });

    const res = await call(ctx.app, ctx.operatorToken, 'GET', `/api/v1/products/${product.id}`);

    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: ProductDetailDto }>();
    expect(data.lots.map((lot) => lot.lotCode)).toEqual(['A', 'B']);
    expect(data.lots[0]).toMatchObject({
      quantity: 1.5,
      expiryDate: '2026-11-02',
      daysToExpiry: 7,
      expired: false,
    });
    expect(data.availableQty).toBe(4.5);
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const missing = await call(
      ctx.app,
      ctx.adminToken,
      'GET',
      '/api/v1/products/2f1c9b1e-0000-4000-8000-000000000000',
    );
    const malformed = await call(ctx.app, ctx.adminToken, 'GET', '/api/v1/products/not-a-uuid');

    expect(missing.statusCode).toBe(404);
    expect(errorCode(missing)).toBe('NOT_FOUND');
    expect(malformed.statusCode).toBe(400);
  });
});
