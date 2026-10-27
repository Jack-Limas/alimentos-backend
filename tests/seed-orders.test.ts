import { describe, expect, it } from 'vitest';
import { buildAlerts } from '../src/modules/alerts/domain/index.js';
import {
  addDays,
  daysBetween,
  productMetrics,
  sumQty,
  toMilli,
} from '../src/modules/inventory/domain/index.js';
import { CATALOG } from '../src/seed/catalog.js';
import { CUSTOMERS } from '../src/seed/customers.js';
import { buildDemoInventory } from '../src/seed/demo-inventory.js';
import { buildDemoOrders, type DemoOrders } from '../src/seed/demo-orders.js';
import { seedOrders, type OrdersSeedStore, type SeedCustomer } from '../src/seed/seed-orders.js';

const TODAY = '2026-10-26';
const NOW = new Date('2026-10-26T15:00:00Z');
const products = CATALOG.map((item, index) => ({ id: `product-${index}`, item }));
const customerIds = CUSTOMERS.filter((c) => c.status === 'ACTIVE').map((_, i) => `customer-${i}`);

function build(today = TODAY) {
  let counter = 0;
  return buildDemoOrders({
    customerIds,
    products,
    today,
    now: NOW,
    userId: 'admin-id',
    newId: () => `id-${++counter}`,
  });
}

describe('CUSTOMERS', () => {
  it('has 15 customers of every type, with at least 2 food banks and unique names', () => {
    expect(CUSTOMERS).toHaveLength(15);
    const types = CUSTOMERS.map((c) => c.type);
    expect(new Set(types)).toEqual(
      new Set(['SUPERMARKET', 'RESTAURANT', 'SCHOOL', 'HOSPITAL', 'FOOD_BANK']),
    );
    expect(types.filter((t) => t === 'FOOD_BANK').length).toBeGreaterThanOrEqual(2);
    expect(new Set(CUSTOMERS.map((c) => c.name)).size).toBe(15);
    for (const c of CUSTOMERS) expect(c.address).toContain('Bogotá');
  });

  it('only uses the reserved example.com domain for emails', () => {
    for (const { email } of CUSTOMERS) if (email) expect(email).toMatch(/@example\.com$/);
  });
});

describe('buildDemoOrders', () => {
  const demo = build();
  const pending = demo.orders.filter((o) => o.status === 'PENDING');
  const offsets = pending.map((o) => daysBetween(TODAY, o.dueDate));

  it('creates 35 PENDING and 2 CANCELLED orders for active customers', () => {
    expect(pending).toHaveLength(35);
    expect(demo.orders.filter((o) => o.status === 'CANCELLED')).toHaveLength(2);
    for (const order of demo.orders) expect(customerIds).toContain(order.customerId);
  });

  it('spreads due dates: some overdue, several today or tomorrow, the rest in 3 to 14 days', () => {
    expect(offsets.filter((d) => d < 0).length).toBeGreaterThanOrEqual(2);
    expect(offsets.filter((d) => d === 0 || d === 1).length).toBeGreaterThanOrEqual(5);
    for (const d of offsets.filter((d) => d > 1)) {
      expect(d).toBeGreaterThanOrEqual(3);
      expect(d).toBeLessThanOrEqual(14);
    }
  });

  it('gives every order 1 to 5 distinct products with valid quantities', () => {
    for (const order of demo.orders) {
      const lines = demo.items.filter((item) => item.orderId === order.id);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(5);
      expect(new Set(lines.map((l) => l.productId)).size).toBe(lines.length);
      for (const line of lines) {
        expect(line.requestedQty).toBeGreaterThan(0);
        expect(toMilli(line.requestedQty) % 1).toBe(0);
      }
    }
  });

  it('uses varied priorities and creates every order before it is due, in the past', () => {
    expect(new Set(demo.orders.map((o) => o.priority)).size).toBeGreaterThanOrEqual(3);
    for (const order of demo.orders) {
      expect(order.createdAt.getTime()).toBeLessThan(NOW.getTime());
      expect(order.createdAt.toISOString().slice(0, 10) <= order.dueDate).toBe(true);
    }
  });

  it('numbers orders by creation time and records their history', () => {
    const times = demo.orders.map((o) => o.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (const order of demo.orders) {
      const rows = demo.history.filter((h) => h.orderId === order.id).map((h) => h.toStatus);
      expect(rows).toEqual(order.status === 'CANCELLED' ? ['PENDING', 'CANCELLED'] : ['PENDING']);
    }
  });

  it('requests products about to expire', () => {
    const expiring = new Set(
      products.filter((p) => p.item.scenario === 'EXPIRING').map((p) => p.id),
    );
    const requested = demo.items.filter((item) => expiring.has(item.productId));
    expect(new Set(requested.map((i) => i.productId)).size).toBe(expiring.size);
  });

  it('raises SHORTAGE_RISK for at least 3 products against the demo inventory', () => {
    expect(shortageProducts(demo).length).toBeGreaterThanOrEqual(3);
  });

  it('is reproducible and relative to today', () => {
    const again = build();
    const later = build(addDays(TODAY, 10));
    expect(again.items.map((i) => [i.productId, i.requestedQty])).toEqual(
      demo.items.map((i) => [i.productId, i.requestedQty]),
    );
    later.orders.forEach((order, index) => {
      expect(daysBetween(demo.orders[index]?.dueDate ?? '', order.dueDate)).toBe(10);
    });
  });

  it('builds nothing without customers or products', () => {
    const none = buildDemoOrders({
      customerIds: [],
      products,
      today: TODAY,
      now: NOW,
      userId: 'a',
    });
    expect(none.orders).toHaveLength(0);
  });
});

/** Products whose PENDING demand exceeds the demo stock (same rule as GET /alerts). */
function shortageProducts(demo: DemoOrders): string[] {
  const inventory = buildDemoInventory({ products, today: TODAY, userId: 'admin-id' });
  const pendingIds = new Set(demo.orders.filter((o) => o.status === 'PENDING').map((o) => o.id));
  const productOfLot = new Map(inventory.lots.map((lot) => [lot.id, lot.productId]));
  const since = NOW.getTime() - 30 * 86_400_000;

  const alerts = buildAlerts({
    products: products.map(({ id, item }) => ({
      id,
      name: item.name,
      minStock: item.minStock,
      metrics: productMetrics(
        { minStock: item.minStock, lots: inventory.lots.filter((l) => l.productId === id) },
        sumQty(
          inventory.movements
            .filter((m) => m.type === 'EXIT_DISPATCH' && productOfLot.get(m.lotId) === id)
            .filter((m) => m.createdAt.getTime() >= since)
            .map((m) => m.quantity),
        ),
        TODAY,
      ),
      pendingDemand: sumQty(
        demo.items
          .filter((i) => i.productId === id && pendingIds.has(i.orderId))
          .map((i) => i.requestedQty),
      ),
    })),
    orders: [],
    today: TODAY,
  });
  return alerts.filter((a) => a.type === 'SHORTAGE_RISK').map((a) => a.entityId);
}

function createMemoryStore(withProducts = true) {
  const state = {
    customers: [] as SeedCustomer[],
    orders: [] as DemoOrders['orders'],
    items: [] as DemoOrders['items'],
    history: [] as DemoOrders['history'],
  };
  const store: OrdersSeedStore = {
    countCustomers: () => Promise.resolve(state.customers.length),
    insertCustomers(customers) {
      state.customers.push(...customers);
      return Promise.resolve();
    },
    activeCustomerIds: () =>
      Promise.resolve(state.customers.filter((c) => c.status === 'ACTIVE').map((c) => c.id)),
    countOrders: () => Promise.resolve(state.orders.length),
    products: () =>
      Promise.resolve(
        withProducts
          ? products.map(({ id, item }) => ({ id, name: item.name, status: 'ACTIVE' as const }))
          : [],
      ),
    insertOrders({ orders, items, history }) {
      state.orders.push(...orders);
      state.items.push(...items);
      state.history.push(...history);
      return Promise.resolve();
    },
  };
  return { state, store };
}

describe('seedOrders', () => {
  const input = { adminUserId: 'admin-id', today: TODAY, now: NOW };

  it('seeds customers and orders once and never duplicates them', async () => {
    const { state, store } = createMemoryStore();

    const first = await seedOrders({ store, ...input });
    const counts = [state.customers.length, state.orders.length, state.items.length];
    const second = await seedOrders({ store, ...input });

    expect(first).toEqual({ customersCreated: 15, ordersCreated: 37, itemsCreated: counts[2] });
    expect(second).toEqual({ customersCreated: 0, ordersCreated: 0, itemsCreated: 0 });
    expect([state.customers.length, state.orders.length, state.items.length]).toEqual(counts);
  });

  it('never places orders for the inactive customer', async () => {
    const { state, store } = createMemoryStore();
    await seedOrders({ store, ...input });
    const inactive = state.customers.filter((c) => c.status === 'INACTIVE').map((c) => c.id);
    expect(inactive).toHaveLength(1);
    expect(state.orders.some((o) => inactive.includes(o.customerId))).toBe(false);
  });

  it('creates no orders when there are no catalog products yet', async () => {
    const { state, store } = createMemoryStore(false);
    const result = await seedOrders({ store, ...input });
    expect(result.ordersCreated).toBe(0);
    expect(state.customers).toHaveLength(15);
  });
});
