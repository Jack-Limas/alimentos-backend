import { randomUUID } from 'node:crypto';
import type { CustomerType, OrderPriority, ProductCategory, Unit } from '@prisma/client';
import { addDays, toDbDate, type CalendarDate } from '../modules/inventory/domain/index.js';
import { createRandom } from './random.js';

export const BENCH_SIZES = { products: 2_000, lots: 20_000, orders: 5_000, customers: 80 } as const;
/** Every bench product name starts with this, so a second run can detect the first one. */
export const BENCH_PREFIX = 'Bench';

const CATEGORIES: readonly ProductCategory[] = [
  'FRUITS_VEGETABLES',
  'DAIRY',
  'MEAT_POULTRY',
  'FISH',
  'BAKERY',
  'GRAINS_LEGUMES',
  'CANNED',
  'BEVERAGES',
  'FROZEN',
  'OTHER',
];
const UNITS: readonly Unit[] = ['KG', 'L', 'UNIT', 'BOX'];
const CUSTOMER_TYPES: readonly CustomerType[] = [
  'SUPERMARKET',
  'RESTAURANT',
  'SCHOOL',
  'HOSPITAL',
  'FOOD_BANK',
];
const PRIORITIES: readonly OrderPriority[] = ['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'URGENT'];

export interface BenchData {
  products: { id: string; name: string; category: ProductCategory; unit: Unit; minStock: string }[];
  customers: { id: string; name: string; type: CustomerType; address: string }[];
  lots: {
    id: string;
    productId: string;
    lotCode: string;
    quantity: string;
    initialQuantity: string;
    expiryDate: Date;
    receivedAt: Date;
  }[];
  movements: {
    id: string;
    lotId: string;
    type: 'ENTRY';
    quantity: string;
    reason: string;
    userId: string;
    createdAt: Date;
  }[];
  orders: {
    id: string;
    customerId: string;
    priority: OrderPriority;
    dueDate: Date;
    createdById: string;
    createdAt: Date;
  }[];
  items: { id: string; orderId: string; productId: string; requestedQty: string }[];
  history: {
    id: string;
    orderId: string;
    fromStatus: null;
    toStatus: 'PENDING';
    userId: string;
    createdAt: Date;
  }[];
}

const pick = <T>(values: readonly T[], index: number): T => values[index % values.length] as T;

/**
 * The large bench dataset as rows ready for createMany: ~2,000 products,
 * ~20,000 lots with their ENTRY movements and 5,000 PENDING orders with
 * 1–5 items each. Quantities come from a seeded PRNG; ids are new UUIDs.
 */
export function buildBenchData({
  today,
  now,
  userId,
  seed = 20_261_028,
  sizes = BENCH_SIZES,
}: {
  today: CalendarDate;
  now: Date;
  userId: string;
  seed?: number;
  sizes?: { products: number; lots: number; orders: number; customers: number };
}): BenchData {
  const random = createRandom(seed);
  const pad = (value: number, width: number) => String(value).padStart(width, '0');

  const products = Array.from({ length: sizes.products }, (_, i) => ({
    id: randomUUID(),
    name: `${BENCH_PREFIX} producto ${pad(i + 1, 5)}`,
    category: pick(CATEGORIES, i),
    unit: pick(UNITS, i),
    minStock: String(random.int(0, 40) * 5),
  }));
  const customers = Array.from({ length: sizes.customers }, (_, i) => ({
    id: randomUUID(),
    name: `${BENCH_PREFIX} cliente ${pad(i + 1, 3)}`,
    type: pick(CUSTOMER_TYPES, i),
    address: `Calle ${String(10 + (i % 90))} # ${String(i + 1)}-${String(10 + (i % 80))}, Bogotá`,
  }));

  const lots: BenchData['lots'] = [];
  const movements: BenchData['movements'] = [];
  for (let i = 0; i < sizes.lots; i += 1) {
    const product = products[i % products.length] as BenchData['products'][number];
    const quantity = String(random.int(1, 80) * 5);
    const receivedAt = new Date(now.getTime() - random.int(1, 40) * 86_400_000);
    const lot = {
      id: randomUUID(),
      productId: product.id,
      lotCode: `B-${pad(i + 1, 6)}`,
      quantity,
      initialQuantity: quantity,
      expiryDate: toDbDate(addDays(today, random.int(-3, 120))),
      receivedAt,
    };
    lots.push(lot);
    movements.push({
      id: randomUUID(),
      lotId: lot.id,
      type: 'ENTRY',
      quantity,
      reason: 'seed:bench',
      userId,
      createdAt: receivedAt,
    });
  }

  const orders: BenchData['orders'] = [];
  const items: BenchData['items'] = [];
  const history: BenchData['history'] = [];
  for (let i = 0; i < sizes.orders; i += 1) {
    const createdAt = new Date(now.getTime() - random.int(1, 20 * 24 * 60) * 60_000);
    const order = {
      id: randomUUID(),
      customerId: (customers[random.int(0, customers.length - 1)] as BenchData['customers'][number])
        .id,
      priority: pick(PRIORITIES, random.int(0, PRIORITIES.length - 1)),
      dueDate: toDbDate(addDays(today, random.int(-2, 14))),
      createdById: userId,
      createdAt,
    };
    orders.push(order);
    history.push({
      id: randomUUID(),
      orderId: order.id,
      fromStatus: null,
      toStatus: 'PENDING',
      userId,
      createdAt,
    });
    // (orderId, productId) is unique: distinct products per order.
    const used = new Set<number>();
    for (let k = random.int(1, 5); k > 0; k -= 1) {
      let index = random.int(0, products.length - 1);
      while (used.has(index)) index = (index + 1) % products.length;
      used.add(index);
      items.push({
        id: randomUUID(),
        orderId: order.id,
        productId: (products[index] as BenchData['products'][number]).id,
        requestedQty: String(random.int(1, 60) / 2),
      });
    }
  }

  return { products, customers, lots, movements, orders, items, history };
}

/** Splits rows into batches for createMany (one round trip and one statement each). */
export function inBatches<T>(rows: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += size) batches.push(rows.slice(i, i + size));
  return batches;
}
