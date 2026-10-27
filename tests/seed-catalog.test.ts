import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  productMetrics,
  sumQty,
  type ProductMetrics,
} from '../src/modules/inventory/domain/index.js';
import { CATALOG } from '../src/seed/catalog.js';
import { buildDemoInventory, type DemoLot, type DemoMovement } from '../src/seed/demo-inventory.js';

const TODAY = '2026-10-26';
const NOW = new Date('2026-10-26T15:00:00Z'); // 10:00 in Bogota
const products = CATALOG.map((item, index) => ({ id: `product-${index}`, item }));

function build(today = TODAY) {
  let counter = 0;
  return buildDemoInventory({
    products,
    today,
    userId: 'admin-id',
    newId: () => `id-${++counter}`,
  });
}

function metricsByProduct(lots: DemoLot[], movements: DemoMovement[], today = TODAY, now = NOW) {
  const since = now.getTime() - 30 * 86_400_000;
  const productOfLot = new Map(lots.map((lot) => [lot.id, lot.productId]));
  return new Map<string, ProductMetrics>(
    products.map(({ id, item }) => {
      const outflow = sumQty(
        movements
          .filter((m) => m.type === 'EXIT_DISPATCH' && productOfLot.get(m.lotId) === id)
          .filter((m) => m.createdAt.getTime() >= since)
          .map((m) => m.quantity),
      );
      const ownLots = lots.filter((lot) => lot.productId === id);
      return [id, productMetrics({ minStock: item.minStock, lots: ownLots }, outflow, today)];
    }),
  );
}

describe('CATALOG', () => {
  it('has about 50 products with unique names (ignoring case)', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(50);
    const names = CATALOG.map((item) => item.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('has coherent values and every demo scenario', () => {
    for (const item of CATALOG) {
      expect(item.minStock).toBeGreaterThan(0);
      expect(item.shelfLifeDays).toBeGreaterThan(1);
      expect(item.dailyOut).toBeGreaterThanOrEqual(0);
      if (item.unit === 'UNIT' || item.unit === 'BOX')
        expect(Number.isInteger(item.minStock)).toBe(true);
    }
    const scenarios = new Set(CATALOG.map((item) => item.scenario));
    expect([...scenarios].sort()).toEqual(
      ['EXPIRED', 'EXPIRING', 'HEALTHY', 'IDLE', 'LOW', 'OUT', 'WASTE'].sort(),
    );
  });
});

describe('buildDemoInventory', () => {
  const { lots, movements } = build();
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));

  it('gives each product 1 to 3 lots with stock, and none to OUT products', () => {
    for (const { id, item } of products) {
      const withStock = lots.filter((lot) => lot.productId === id && lot.quantity > 0);
      if (item.scenario === 'OUT') expect(withStock).toHaveLength(0);
      else {
        expect(withStock.length).toBeGreaterThanOrEqual(1);
        expect(withStock.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('keeps lots and movements consistent: entry = initial, initial - dispatches = quantity', () => {
    for (const lot of lots) {
      const own = movements.filter((m) => m.lotId === lot.id);
      const entries = own.filter((m) => m.type === 'ENTRY');
      const dispatched = sumQty(
        own.filter((m) => m.type === 'EXIT_DISPATCH').map((m) => m.quantity),
      );

      expect(entries).toHaveLength(1);
      expect(entries[0]?.quantity).toBe(lot.initialQuantity);
      expect(sumQty([lot.initialQuantity, -dispatched])).toBe(lot.quantity);
      expect(lot.quantity).toBeGreaterThanOrEqual(0);
    }
  });

  it('dispatches only after reception, before expiry and inside the 30-day window', () => {
    const windowStart = NOW.getTime() - 30 * 86_400_000;
    for (const m of movements.filter((movement) => movement.type === 'EXIT_DISPATCH')) {
      const lot = lotById.get(m.lotId);
      expect(lot).toBeDefined();
      if (!lot) continue;
      expect(m.createdAt.getTime()).toBeGreaterThanOrEqual(lot.receivedAt.getTime());
      expect(m.createdAt.toISOString().slice(0, 10) < lot.expiryDate).toBe(true);
      expect(m.createdAt.getTime()).toBeGreaterThan(windowStart);
      expect(m.createdAt.getTime()).toBeLessThan(NOW.getTime());
    }
  });

  it('never records anything in the future', () => {
    for (const lot of lots) expect(lot.receivedAt.getTime()).toBeLessThan(NOW.getTime());
  });

  it('leaves IDLE products without dispatches', () => {
    const idle = products.filter(({ item }) => item.scenario === 'IDLE').map(({ id }) => id);
    const idleLots = new Set(
      lots.filter((lot) => idle.includes(lot.productId)).map((lot) => lot.id),
    );
    expect(movements.some((m) => m.type === 'EXIT_DISPATCH' && idleLots.has(m.lotId))).toBe(false);
  });

  it('always shows low stock, out of stock, expiring lots, expired stock and waste risk', () => {
    const metrics = [...metricsByProduct(lots, movements).values()];
    const count = (predicate: (m: ProductMetrics) => boolean) => metrics.filter(predicate).length;

    expect(count((m) => m.stockStatus === 'OUT')).toBeGreaterThanOrEqual(3);
    expect(count((m) => m.stockStatus === 'LOW')).toBeGreaterThanOrEqual(5);
    expect(
      count((m) => m.daysToNearestExpiry !== null && m.daysToNearestExpiry <= 7),
    ).toBeGreaterThanOrEqual(5);
    expect(count((m) => m.expiredQty > 0)).toBeGreaterThanOrEqual(3);
    expect(count((m) => m.wasteRisk === 'HIGH')).toBeGreaterThanOrEqual(3);
    expect(count((m) => m.stockStatus === 'OK' && m.wasteRisk === 'NONE')).toBeGreaterThan(
      metrics.length / 2,
    );
  });

  it('matches each scenario to its intended metrics', () => {
    const metrics = metricsByProduct(lots, movements);
    for (const { id, item } of products) {
      const m = metrics.get(id);
      if (!m) throw new Error('missing metrics');
      switch (item.scenario) {
        case 'HEALTHY':
          expect([item.name, m.stockStatus, m.wasteRisk]).toEqual([item.name, 'OK', 'NONE']);
          break;
        case 'LOW':
          expect([item.name, m.stockStatus]).toEqual([item.name, 'LOW']);
          break;
        case 'OUT':
          expect([item.name, m.stockStatus]).toEqual([item.name, 'OUT']);
          break;
        case 'EXPIRING':
          expect([item.name, m.wasteRisk]).toEqual([item.name, 'LOW']);
          break;
        case 'EXPIRED':
          expect([item.name, m.expiredQty > 0]).toEqual([item.name, true]);
          break;
        case 'WASTE':
          expect([item.name, m.wasteRisk]).toEqual([item.name, 'HIGH']);
          break;
        case 'IDLE':
          expect([item.name, m.avgDailyOut30d]).toEqual([item.name, 0]);
          break;
      }
    }
  });

  it('is reproducible and relative to today', () => {
    const again = build();
    const later = build(addDays(TODAY, 40));

    expect(again.lots.map((lot) => [lot.quantity, lot.expiryDate])).toEqual(
      lots.map((lot) => [lot.quantity, lot.expiryDate]),
    );
    later.lots.forEach((lot, index) => {
      const original = lots[index];
      if (!original) throw new Error('missing lot');
      expect(daysBetween(original.expiryDate, lot.expiryDate)).toBe(40);
      expect(lot.quantity).toBe(original.quantity);
    });
  });
});
