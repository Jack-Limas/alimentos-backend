import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '../src/modules/inventory/domain/index.js';
import {
  addProduct,
  buildInventoryTestApp,
  call,
  TODAY,
  type InventoryTestContext,
} from './helpers/inventory-fixtures.js';
import { addCustomer, auditActions } from './helpers/order-fixtures.js';

// One app (and one lazy worker pool, started on the first report) for the whole file.
let context: InventoryTestContext;

beforeAll(async () => {
  context = await buildInventoryTestApp();
  const rice = addProduct(context, { name: 'Arroz blanco', minStock: 10 });
  const yogurt = addProduct(context, { name: 'Yogur natural', category: 'DAIRY', unit: 'L' });
  addProduct(context, { name: '=HYPERLINK("evil")', category: 'OTHER' });
  context.repositories.inventory.addLot({
    productId: rice.id,
    quantity: 50,
    expiryDate: addDays(TODAY, 90),
    receivedAt: new Date('2026-10-01T12:00:00Z'),
  });
  // Expires in 3 days with no outflow: HIGH waste risk today.
  const lot = context.repositories.inventory.addLot({
    productId: yogurt.id,
    quantity: 12,
    expiryDate: addDays(TODAY, 3),
    receivedAt: new Date('2026-10-20T12:00:00Z'),
    lotCode: 'YOG-01',
  });
  context.repositories.inventory.addMovement({
    lotId: lot.id,
    type: 'EXIT_WASTE',
    quantity: 2.5,
    reason: 'Envase roto; "golpe" en bodega',
    orderId: null,
    userId: context.admin.id,
    createdAt: new Date('2026-10-22T15:00:00Z'),
  });
  const customer = addCustomer(context, { name: 'Colegio Los Pinos', type: 'SCHOOL' });
  context.repositories.orders.addOrder(
    {
      customerId: customer.id,
      createdById: context.admin.id,
      priority: 'HIGH',
      createdAt: new Date('2026-10-20T15:00:00Z'),
    },
    [{ productId: rice.id, requestedQty: 5 }],
  );
  context.repositories.orders.addOrder(
    {
      customerId: customer.id,
      createdById: context.admin.id,
      priority: 'LOW',
      createdAt: new Date('2026-08-01T15:00:00Z'),
    },
    [{ productId: rice.id, requestedQty: 1 }],
  );
});

afterAll(async () => {
  await context.app.close();
});

const download = (path: string, token = context.adminToken) =>
  call(context.app, token, 'GET', `/api/v1/reports/${path}`);
const csvText = (res: LightMyRequestResponse) =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(res.rawPayload);

describe('GET /reports/:kind', { timeout: 30_000 }, () => {
  it('builds the inventory CSV in Spanish: BOM, ";" and decimal comma, injection guarded', async () => {
    const res = await download('inventory?format=csv&locale=es');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toContain(
      'filename="alimentaiq-inventario-2026-10-26.csv"',
    );
    expect(Number(res.headers['x-generation-time-ms'])).toBeGreaterThan(0);
    expect(String(res.headers['server-timing'])).toMatch(
      /^db;dur=[\d.]+, render;dur=[\d.]+, app;dur=[\d.]+$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');

    const csv = csvText(res);
    expect(csv.startsWith('﻿Producto;Categoría;Unidad;Disponible')).toBe(true);
    expect(csv).toContain('Arroz blanco;Granos y legumbres;kg;50;10;Normal');
    expect(csv).toContain(`'=HYPERLINK(""evil"")`);
    expect(csv).toContain('Productos activos;3');
  });

  it('builds the inventory PDF in English', async () => {
    const res = await download('inventory?format=pdf&locale=en');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('alimentaiq-inventory-2026-10-26.pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('lists the orders created in the range only (default: the last 30 days)', async () => {
    const recent = csvText(await download('orders?format=csv&locale=en'));
    expect(recent).toContain('Order,Customer,Type,Priority,Status,Due,Created,Items');
    expect(recent).toContain('Colegio Los Pinos,School,High,Pending');
    expect(recent).not.toContain(',Low,');

    const august = await download('orders?format=csv&locale=en&from=2026-08-01&to=2026-08-01');
    expect(august.headers['content-disposition']).toContain(
      'alimentaiq-orders-2026-08-01_2026-08-01.csv',
    );
    expect(csvText(august)).toContain(',Low,Pending');
    expect(csvText(august)).toContain('Orders,1');
  });

  it('builds the waste report: EXIT_WASTE of the range and HIGH risk products today', async () => {
    const csv = csvText(await download('waste?format=csv&locale=es'));
    expect(csv).toContain(
      'Mermas registradas\r\nFecha;Producto;Lote;Vencimiento;Cantidad;Unidad;Motivo',
    );
    expect(csv).toContain(
      '2026-10-22;Yogur natural;YOG-01;2026-10-29;2,5;L;"Envase roto; ""golpe"" en bodega"',
    );
    expect(csv).toContain('Productos con riesgo de merma alto hoy');
    expect(csv).toMatch(/Yogur natural;Lácteos;12;L;2026-10-29;3;0/);

    const pdf = await download('waste?format=pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('records who exported what, without the content', () => {
    expect(auditActions(context)).toContain('REPORT_EXPORTED');
  });

  it.each([
    ['an unknown report', 'stock'],
    ['an unknown format', 'inventory?format=xlsx'],
    ['an unknown locale', 'inventory?locale=fr'],
    ['a bad date', 'orders?from=2026-02-30'],
    ['from after to', 'orders?from=2026-10-20&to=2026-10-10'],
    ['a range over a year', 'orders?from=2025-01-01&to=2026-10-20'],
    ['an extra parameter', 'inventory?format=csv&debug=1'],
  ])('rejects %s with 400', async (_case, path) => {
    expect((await download(path)).statusCode).toBe(400);
  });

  it('is ADMIN only', async () => {
    expect((await download('inventory', context.operatorToken)).statusCode).toBe(403);
    const anonymous = await context.app.inject({ method: 'GET', url: '/api/v1/reports/inventory' });
    expect(anonymous.statusCode).toBe(401);
  });
});
