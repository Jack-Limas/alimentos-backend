import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addDays, todayIn } from '../src/modules/inventory/domain/index.js';
import { CATALOG } from '../src/seed/catalog.js';
import { buildDemoInventory } from '../src/seed/demo-inventory.js';
import {
  buildDeliveryHistory,
  seedHistory,
  type HistoryInput,
  type HistoryPlan,
  type HistorySeedStore,
} from '../src/seed/history-seed.js';

const ZONE = 'America/Bogota';
const NOW = new Date('2026-10-29T17:00:00.000Z');
const TODAY = todayIn(ZONE, NOW);
const ADMIN_ID = randomUUID();
const OPERATOR_ID = randomUUID();
const CUSTOMERS: string[] = Array.from({ length: 12 }, () => randomUUID());

/** The regular demo seed: products, lots and its 29 days of EXIT_DISPATCH. */
function demo() {
  const products = CATALOG.map((item): { id: string; item: typeof item } => ({
    id: randomUUID(),
    item,
  }));
  const inventory = buildDemoInventory({ products, today: TODAY, userId: ADMIN_ID });
  const productOfLot = new Map(inventory.lots.map((lot) => [lot.id, lot.productId]));
  const unitOf = new Map(products.map((p) => [p.id, p.item.unit]));
  const dispatches = inventory.movements
    .filter((m) => m.type === 'EXIT_DISPATCH')
    .map((m) => ({
      id: m.id,
      productId: productOfLot.get(m.lotId) ?? '',
      quantity: m.quantity,
      createdAt: m.createdAt,
    }));
  const stockLots = inventory.lots
    .filter((lot) => lot.quantity > 0)
    .map((lot) => ({
      id: lot.id,
      quantity: lot.quantity,
      unit: unitOf.get(lot.productId) ?? 'KG',
      expiryDate: lot.expiryDate,
    }));
  return { dispatches, stockLots };
}

function plan(overrides: Partial<HistoryInput> = {}): HistoryPlan & ReturnType<typeof demo> {
  const data = demo();
  return {
    ...data,
    ...buildDeliveryHistory({
      customerIds: CUSTOMERS,
      ...data,
      today: TODAY,
      now: NOW,
      timeZone: ZONE,
      adminId: ADMIN_ID,
      operatorId: OPERATOR_ID,
      ...overrides,
    }),
  };
}

describe('seed:history plan', () => {
  it('makes about 60 delivered orders in the last 30 days, about 80 % on time', () => {
    const result = plan();
    const delivered = new Map(
      result.history.filter((h) => h.toStatus === 'DELIVERED').map((h) => [h.orderId, h.createdAt]),
    );

    expect(result.orders).toHaveLength(60);
    expect(new Set(result.orders.map((o) => o.status))).toEqual(new Set(['DELIVERED']));
    const onTime = result.orders.filter(
      (o) => o.dueDate >= todayIn(ZONE, delivered.get(o.id) ?? NOW),
    ).length;
    expect(onTime).toBe(48);
    for (const at of delivered.values()) {
      expect(at.getTime()).toBeLessThan(NOW.getTime());
      expect(todayIn(ZONE, at) >= addDays(TODAY, -30)).toBe(true);
    }
  });

  it('writes a coherent status history for every order', () => {
    const result = plan();
    const sequence = ['PENDING', 'IN_PREPARATION', 'READY_FOR_DISPATCH', 'SHIPPED', 'DELIVERED'];
    for (const order of result.orders) {
      const rows = result.history.filter((h) => h.orderId === order.id);
      expect(rows.map((r) => r.toStatus)).toEqual(sequence);
      expect(rows.map((r) => r.fromStatus)).toEqual([null, ...sequence.slice(0, -1)]);
      const times = rows.map((r) => r.createdAt.getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(rows[0]?.createdAt).toEqual(order.createdAt);
      // Never due before the order existed.
      expect(order.dueDate >= todayIn(ZONE, order.createdAt)).toBe(true);
    }
  });

  it('links each order to historical dispatches of the same products, once each', () => {
    const result = plan();
    const byId = new Map(result.dispatches.map((d) => [d.id, d]));
    const linked = result.links.map((l) => l.movementId);
    expect(new Set(linked).size).toBe(linked.length);

    for (const order of result.orders) {
      const movements = result.links
        .filter((l) => l.orderId === order.id)
        .map((l) => byId.get(l.movementId));
      const items = result.items.filter((i) => i.orderId === order.id);
      expect(movements.length).toBeGreaterThan(0);
      for (const item of items) {
        const sum = movements
          .filter((m) => m?.productId === item.productId)
          .reduce((total, m) => total + (m?.quantity ?? 0), 0);
        expect(item.quantity).toBeCloseTo(sum, 3);
      }
      // One item per product, and the SHIPPED row is the last dispatch.
      expect(new Set(items.map((i) => i.productId)).size).toBe(items.length);
      const shipped = result.history.find(
        (h) => h.orderId === order.id && h.toStatus === 'SHIPPED',
      );
      expect(shipped?.createdAt.getTime()).toBe(
        Math.max(...movements.map((m) => m?.createdAt.getTime() ?? 0)),
      );
    }
  });

  it('adds a few recent waste exits that never take more than a third of a lot', () => {
    const result = plan();
    const lots = new Map(result.stockLots.map((lot) => [lot.id, lot]));

    expect(result.waste.length).toBe(6);
    for (const waste of result.waste) {
      const lot = lots.get(waste.lotId);
      expect(lot).toBeDefined();
      expect(waste.quantity).toBeGreaterThan(0);
      expect(waste.quantity).toBeLessThanOrEqual((lot?.quantity ?? 0) / 3 + 1e-9);
      expect(todayIn(ZONE, waste.createdAt) < TODAY).toBe(true);
      expect(todayIn(ZONE, waste.createdAt) >= addDays(TODAY, -7)).toBe(true);
    }
  });

  it('is deterministic for the same data and seed', () => {
    const data = demo();
    const input = {
      customerIds: CUSTOMERS,
      ...data,
      today: TODAY,
      now: NOW,
      timeZone: ZONE,
      adminId: ADMIN_ID,
      operatorId: OPERATOR_ID,
    };
    let n = 0;
    const ids = (): string => `id-${String((n += 1))}`;
    const first = buildDeliveryHistory({ ...input, newId: ids });
    n = 0;
    expect(buildDeliveryHistory({ ...input, newId: ids })).toEqual(first);
  });

  it('makes nothing without customers or dispatches', () => {
    expect(plan({ customerIds: [] }).orders).toHaveLength(0);
    expect(plan({ dispatches: [] }).orders).toHaveLength(0);
  });
});

describe('seedHistory (idempotent)', () => {
  function memoryStore(): HistorySeedStore & { applied: HistoryPlan[]; delivered: number } {
    const data = demo();
    const store = {
      applied: [] as HistoryPlan[],
      delivered: 0,
      countDelivered: () => Promise.resolve(store.delivered),
      activeCustomerIds: () => Promise.resolve([...CUSTOMERS]),
      unlinkedDispatches: () => Promise.resolve(data.dispatches),
      stockLots: () => Promise.resolve(data.stockLots),
      apply: (applied: HistoryPlan) => {
        store.applied.push(applied);
        store.delivered += applied.orders.length;
        return Promise.resolve();
      },
    };
    return store;
  }
  const input = {
    today: TODAY,
    now: NOW,
    timeZone: ZONE,
    adminId: ADMIN_ID,
    operatorId: OPERATOR_ID,
  };

  it('seeds once and then does nothing', async () => {
    const store = memoryStore();
    const first = await seedHistory(store, input);
    expect(first).toMatchObject({ seeded: true, orders: 60, onTime: 48, waste: 6 });
    const second = await seedHistory(store, input);
    expect(second).toEqual({ seeded: false, reason: 'ALREADY_DELIVERED', delivered: 60 });
    expect(store.applied).toHaveLength(1);
  });
});
