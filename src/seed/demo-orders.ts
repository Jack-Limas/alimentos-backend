import { randomUUID } from 'node:crypto';
import type { OrderPriority, Unit } from '@prisma/client';
import { addDays, type CalendarDate } from '../modules/inventory/domain/index.js';
import type { OrderStatus } from '../modules/orders/domain/index.js';
import type { CatalogItem } from './catalog.js';
import { createRandom, type Random } from './random.js';

export interface DemoOrder {
  id: string;
  customerId: string;
  status: Extract<OrderStatus, 'PENDING' | 'CANCELLED'>;
  priority: OrderPriority;
  dueDate: CalendarDate;
  createdById: string;
  createdAt: Date;
}

export interface DemoOrderItem {
  id: string;
  orderId: string;
  productId: string;
  requestedQty: number;
}

export interface DemoHistory {
  id: string;
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  userId: string;
  note: string | null;
  createdAt: Date;
}

export interface DemoOrders {
  orders: DemoOrder[];
  items: DemoOrderItem[];
  history: DemoHistory[];
}

export interface DemoOrdersInput {
  /** Active customers only. */
  customerIds: readonly string[];
  /** Active catalog products. */
  products: readonly { id: string; item: CatalogItem }[];
  /** Business date in APP_TIMEZONE; due dates are relative to it. */
  today: CalendarDate;
  now: Date;
  /** Creator of the orders and author of their history (the seeded admin). */
  userId: string;
  seed?: number;
  newId?: () => string;
}

const PENDING_ORDERS = 35;
const CANCELLED_ORDERS = 2;
const MAX_ITEMS = 5;
const DAY_MS = 86_400_000;
/** Each product short of stock is requested this many times... */
const SHORTAGE_LINES = 3;
/** ...for this share of its minimum each time: 3 × 0.5 = 1.5 × minStock, above any LOW stock. */
const SHORTAGE_SHARE = 0.5;
/** Each product about to expire is requested this many times. */
const EXPIRING_LINES = 2;
const CANCEL_NOTE = 'Cancelado por el cliente (datos demo)';

const PRIORITIES: readonly [OrderPriority, number][] = [
  ['URGENT', 0.15],
  ['HIGH', 0.3],
  ['MEDIUM', 0.35],
  ['LOW', 0.2],
];

/** Countable units are whole; weights and volumes keep one decimal. */
function roundFor(unit: Unit, value: number): number {
  return unit === 'UNIT' || unit === 'BOX'
    ? Math.max(1, Math.round(value))
    : Math.max(0.1, Math.round(value * 10) / 10);
}

function pickPriority(random: Random): OrderPriority {
  let roll = random.next();
  for (const [priority, weight] of PRIORITIES) {
    roll -= weight;
    if (roll < 0) return priority;
  }
  return 'MEDIUM';
}

/** 3 overdue, 8 due today or tomorrow, the rest in 3 to 14 days. */
function dueOffsets(random: Random): number[] {
  const offsets = [-3, -2, -1, 0, 0, 0, 0, 1, 1, 1, 1];
  while (offsets.length < PENDING_ORDERS) offsets.push(random.int(3, 14));
  return offsets;
}

function typicalQty(item: CatalogItem, random: Random): number {
  const base = item.dailyOut > 0 ? item.dailyOut : item.minStock * 0.2;
  return roundFor(item.unit, base * random.between(0.5, 2));
}

/**
 * Demo orders relative to `today`: 35 PENDING with 1 to 5 items and 2
 * CANCELLED without movements. Products that are low or out of stock are
 * requested above what is left (SHORTAGE_RISK) and products about to expire
 * are requested too. No stock is reserved, as with real PENDING orders.
 */
export function buildDemoOrders({
  customerIds,
  products,
  today,
  now,
  userId,
  seed = 2027,
  newId = randomUUID,
}: DemoOrdersInput): DemoOrders {
  const empty: DemoOrders = { orders: [], items: [], history: [] };
  if (customerIds.length === 0 || products.length === 0) return empty;
  const random = createRandom(seed);

  const shells = [
    ...dueOffsets(random).map((offset) => ({ offset, status: 'PENDING' as const })),
    ...Array.from({ length: CANCELLED_ORDERS }, () => ({
      offset: random.int(4, 10),
      status: 'CANCELLED' as const,
    })),
  ].map(({ offset, status }, index) => {
    // Created before it was due: overdue orders are older.
    const daysAgo = Math.max(1, 1 - offset) + random.int(0, 4);
    return {
      order: {
        id: newId(),
        customerId: customerIds[index % customerIds.length] ?? '',
        status,
        priority: pickPriority(random),
        dueDate: addDays(today, offset),
        createdById: userId,
        createdAt: new Date(now.getTime() - daysAgo * DAY_MS - random.int(0, 300) * 60_000),
      } satisfies DemoOrder,
      size: random.int(1, MAX_ITEMS),
      lines: new Map<string, number>(),
    };
  });

  // Forced lines go to PENDING orders only, spread round-robin.
  const pending = shells.filter((shell) => shell.order.status === 'PENDING');
  const forced = [
    ...products
      .filter(({ item }) => item.scenario === 'LOW' || item.scenario === 'OUT')
      .flatMap((p) =>
        Array.from({ length: SHORTAGE_LINES }, () => ({
          id: p.id,
          qty: roundFor(p.item.unit, p.item.minStock * SHORTAGE_SHARE),
        })),
      ),
    ...products
      .filter(({ item }) => item.scenario === 'EXPIRING')
      .flatMap((p) =>
        Array.from({ length: EXPIRING_LINES }, () => ({
          id: p.id,
          qty: typicalQty(p.item, random),
        })),
      ),
  ];
  let cursor = 0;
  for (const line of forced) {
    // The next pending order (round-robin) that has room and lacks the product.
    for (let step = 0; step < pending.length; step += 1) {
      const shell = pending[(cursor + step) % pending.length];
      if (shell && shell.lines.size < MAX_ITEMS && !shell.lines.has(line.id)) {
        shell.lines.set(line.id, line.qty);
        shell.size = Math.max(shell.size, shell.lines.size);
        cursor += step + 1;
        break;
      }
    }
  }

  // Fill the remaining slots with other products of the catalog.
  for (const shell of shells) {
    let attempts = 0;
    while (shell.lines.size < shell.size && attempts < products.length * 2) {
      attempts += 1;
      const product = products[random.int(0, products.length - 1)];
      if (!product || shell.lines.has(product.id)) continue;
      shell.lines.set(product.id, typicalQty(product.item, random));
    }
  }

  // Numbers follow creation time, like orders placed one after the other.
  shells.sort((a, b) => a.order.createdAt.getTime() - b.order.createdAt.getTime());

  const result: DemoOrders = { orders: [], items: [], history: [] };
  for (const { order, lines } of shells) {
    result.orders.push(order);
    for (const [productId, requestedQty] of lines) {
      result.items.push({ id: newId(), orderId: order.id, productId, requestedQty });
    }
    result.history.push({
      id: newId(),
      orderId: order.id,
      fromStatus: null,
      toStatus: 'PENDING',
      userId,
      note: null,
      createdAt: order.createdAt,
    });
    if (order.status === 'CANCELLED') {
      result.history.push({
        id: newId(),
        orderId: order.id,
        fromStatus: 'PENDING',
        toStatus: 'CANCELLED',
        userId,
        note: CANCEL_NOTE,
        createdAt: new Date(order.createdAt.getTime() + 3 * 3_600_000),
      });
    }
  }
  return result;
}
