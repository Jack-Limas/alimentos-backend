import { randomUUID } from 'node:crypto';
import type { ProductStatus } from '@prisma/client';
import type { CalendarDate } from '../modules/inventory/domain/index.js';
import { CATALOG, type CatalogItem } from './catalog.js';
import { CUSTOMERS, type CustomerItem } from './customers.js';
import { buildDemoOrders, type DemoOrders } from './demo-orders.js';

export type SeedCustomer = CustomerItem & { id: string };

export interface OrdersSeedStore {
  countCustomers(): Promise<number>;
  insertCustomers(customers: SeedCustomer[]): Promise<void>;
  activeCustomerIds(): Promise<string[]>;
  countOrders(): Promise<number>;
  products(): Promise<{ id: string; name: string; status: ProductStatus }[]>;
  /** Orders, items and history in a single transaction. */
  insertOrders(demo: DemoOrders): Promise<void>;
}

export interface OrdersSeedResult {
  customersCreated: number;
  ordersCreated: number;
  itemsCreated: number;
}

export interface SeedOrdersInput {
  store: OrdersSeedStore;
  adminUserId: string;
  today: CalendarDate;
  now: Date;
  customers?: readonly CustomerItem[];
  catalog?: readonly CatalogItem[];
  newId?: () => string;
}

/**
 * Idempotent: customers are inserted only while the customers table is empty,
 * and demo orders only while the orders table is empty, so running the seed
 * again never duplicates or changes anything.
 */
export async function seedOrders({
  store,
  adminUserId,
  today,
  now,
  customers = CUSTOMERS,
  catalog = CATALOG,
  newId = randomUUID,
}: SeedOrdersInput): Promise<OrdersSeedResult> {
  let customersCreated = 0;
  if ((await store.countCustomers()) === 0) {
    await store.insertCustomers(customers.map((customer) => ({ id: newId(), ...customer })));
    customersCreated = customers.length;
  }

  if ((await store.countOrders()) > 0)
    return { customersCreated, ordersCreated: 0, itemsCreated: 0 };

  // Orders use the catalog products that exist and are active, matched by name.
  const byName = new Map(catalog.map((item) => [item.name, item]));
  const products = (await store.products()).flatMap((product) => {
    const item = byName.get(product.name);
    return item && product.status === 'ACTIVE' ? [{ id: product.id, item }] : [];
  });

  const demo = buildDemoOrders({
    customerIds: await store.activeCustomerIds(),
    products,
    today,
    now,
    userId: adminUserId,
    newId,
  });
  if (demo.orders.length > 0) await store.insertOrders(demo);
  return { customersCreated, ordersCreated: demo.orders.length, itemsCreated: demo.items.length };
}
