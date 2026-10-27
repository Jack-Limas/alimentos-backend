import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LotDto, MovementDto } from '../src/modules/inventory/inventory.dto.js';
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

/** Milk with an expired lot, one expiring in 3 days and one in 20. */
function milkWithLots() {
  const product = addProduct(ctx, {
    name: 'Leche entera',
    category: 'DAIRY',
    unit: 'L',
    minStock: 5,
  });
  const inventory = ctx.repositories.inventory;
  const expired = inventory.addLot({
    productId: product.id,
    quantity: 4,
    expiryDate: '2026-10-24',
  });
  const soon = inventory.addLot({ productId: product.id, quantity: 10, expiryDate: '2026-10-29' });
  const later = inventory.addLot({ productId: product.id, quantity: 30, expiryDate: '2026-11-15' });
  return { product, expired, soon, later };
}

describe('roles', () => {
  it('returns 403 to an OPERATOR on entries, exits and movements', async () => {
    const { product } = milkWithLots();
    const entry = { productId: product.id, quantity: 5, expiryDate: '2026-12-01' };
    const exit = { productId: product.id, quantity: 1, type: 'EXIT_WASTE', reason: 'Roto' };

    const responses = await Promise.all([
      call(ctx.app, ctx.operatorToken, 'POST', '/api/v1/inventory/entries', entry),
      call(ctx.app, ctx.operatorToken, 'POST', '/api/v1/inventory/exits', exit),
      call(ctx.app, ctx.operatorToken, 'GET', '/api/v1/inventory/movements'),
    ]);

    for (const res of responses) {
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('FORBIDDEN');
    }
    expect(ctx.repositories.inventory.movements).toHaveLength(0);
  });

  it('lets an OPERATOR read lots and the summary', async () => {
    milkWithLots();

    const lots = await call(ctx.app, ctx.operatorToken, 'GET', '/api/v1/inventory/lots');
    const summary = await call(ctx.app, ctx.operatorToken, 'GET', '/api/v1/inventory/summary');

    expect(lots.statusCode).toBe(200);
    expect(summary.statusCode).toBe(200);
  });

  it('requires authentication', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/inventory/summary' });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/inventory/entries', () => {
  it('creates the lot, an ENTRY movement and an audit row (201)', async () => {
    const product = addProduct(ctx, { name: 'Arroz blanco' });

    const res = await call(ctx.app, ctx.adminToken, 'POST', '/api/v1/inventory/entries', {
      productId: product.id,
      quantity: 125.5,
      expiryDate: '2027-04-30',
      lotCode: 'L-2041',
      note: 'Proveedor habitual',
    });

    expect(res.statusCode).toBe(201);
    const { data } = res.json<{ data: { lot: LotDto; movement: MovementDto } }>();
    expect(data.lot).toMatchObject({
      productId: product.id,
      lotCode: 'L-2041',
      quantity: 125.5,
      initialQuantity: 125.5,
      expiryDate: '2027-04-30',
      expired: false,
    });
    expect(data.movement).toMatchObject({
      lotId: data.lot.id,
      productId: product.id,
      type: 'ENTRY',
      quantity: 125.5,
      reason: 'Proveedor habitual',
      userId: ctx.admin.id,
    });
    expect(typeof data.lot.quantity).toBe('number');
    expect(typeof data.movement.quantity).toBe('number');
    expect(ctx.repositories.inventory.lots.size).toBe(1);
    expect(ctx.repositories.inventory.movements).toHaveLength(1);
    expect(ctx.repositories.auditLogs.entries).toContainEqual(
      expect.objectContaining({
        action: 'INVENTORY_ENTRY',
        entity: 'InventoryLot',
        entityId: data.lot.id,
        userId: ctx.admin.id,
      }),
    );
  });

  it('accepts a lot that expires today', async () => {
    const product = addProduct(ctx, { name: 'Pan tajado' });

    const res = await call(ctx.app, ctx.adminToken, 'POST', '/api/v1/inventory/entries', {
      productId: product.id,
      quantity: 1,
      expiryDate: '2026-10-26',
    });

    expect(res.statusCode).toBe(201);
  });

  it.each([
    ['quantity 0', { quantity: 0 }],
    ['negative quantity', { quantity: -3 }],
    ['quantity with 4 decimals', { quantity: 1.2345 }],
    ['impossible date', { expiryDate: '2026-02-30' }],
    ['date with time', { expiryDate: '2026-12-01T00:00:00Z' }],
    ['date in the past (Bogota calendar)', { expiryDate: '2026-10-25' }],
    ['unknown field', { initialQuantity: 9 }],
  ])('rejects %s with 400', async (_label, override) => {
    const product = addProduct(ctx, { name: 'Arroz blanco' });

    const res = await call(ctx.app, ctx.adminToken, 'POST', '/api/v1/inventory/entries', {
      productId: product.id,
      quantity: 10,
      expiryDate: '2026-12-01',
      ...override,
    });

    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
    expect(ctx.repositories.inventory.lots.size).toBe(0);
  });

  it('returns 404 for an unknown product and 400 for an inactive one', async () => {
    const inactive = addProduct(ctx, { name: 'Gaseosa retirada', status: 'INACTIVE' });
    const body = { quantity: 1, expiryDate: '2026-12-01' };

    const missing = await call(ctx.app, ctx.adminToken, 'POST', '/api/v1/inventory/entries', {
      ...body,
      productId: '2f1c9b1e-0000-4000-8000-000000000000',
    });
    const blocked = await call(ctx.app, ctx.adminToken, 'POST', '/api/v1/inventory/entries', {
      ...body,
      productId: inactive.id,
    });

    expect(missing.statusCode).toBe(404);
    expect(blocked.statusCode).toBe(400);
  });
});
