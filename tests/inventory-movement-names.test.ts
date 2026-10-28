import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addProduct,
  buildInventoryTestApp,
  call,
  type InventoryTestContext,
} from './helpers/inventory-fixtures.js';

let context: InventoryTestContext;

beforeEach(async () => {
  context = await buildInventoryTestApp();
});

afterEach(async () => {
  await context.app.close();
});

describe('GET /inventory/movements', () => {
  it('includes the product name and unit of every movement', async () => {
    const milk = addProduct(context, { name: 'Leche entera', unit: 'L' });
    await call(context.app, context.adminToken, 'POST', '/api/v1/inventory/entries', {
      productId: milk.id,
      quantity: 12,
      expiryDate: '2026-11-20',
    });

    const res = await call(context.app, context.adminToken, 'GET', '/api/v1/inventory/movements');

    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toEqual([
      expect.objectContaining({
        type: 'ENTRY',
        productId: milk.id,
        productName: 'Leche entera',
        unit: 'L',
        quantity: 12,
      }),
    ]);
  });
});
