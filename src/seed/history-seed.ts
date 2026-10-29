import { randomUUID } from 'node:crypto';
import type { OrderPriority, Unit } from '@prisma/client';
import { addDays, todayIn, type CalendarDate } from '../modules/inventory/domain/index.js';
import type { OrderStatus } from '../modules/orders/domain/index.js';
import { createRandom, type Random } from './random.js';

/** A historical EXIT_DISPATCH movement not linked to any order yet. */
export interface HistoryDispatch {
  id: string;
  productId: string;
  quantity: number;
  createdAt: Date;
}

/** A lot with stock today, a candidate for the recent waste. */
export interface HistoryStockLot {
  id: string;
  quantity: number;
  unit: Unit;
  expiryDate: CalendarDate;
}

export interface HistoryInput {
  /** Active customers. */
  customerIds: readonly string[];
  dispatches: readonly HistoryDispatch[];
  stockLots: readonly HistoryStockLot[];
  today: CalendarDate;
  now: Date;
  timeZone: string;
  adminId: string;
  /** Who moves the orders through the warehouse (falls back to the admin). */
  operatorId: string;
  /** About 60 delivered orders. */
  targetOrders?: number;
  /** About 80 % arrive by their due date. */
  onTimeRate?: number;
  wasteMovements?: number;
  seed?: number;
  newId?: () => string;
}

export interface HistoryOrder {
  id: string;
  customerId: string;
  status: 'DELIVERED';
  priority: OrderPriority;
  dueDate: CalendarDate;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface HistoryItem {
  id: string;
  orderId: string;
  productId: string;
  /** Requested = allocated = what the linked dispatches took. */
  quantity: number;
}

export interface HistoryStatusRow {
  id: string;
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  userId: string;
  note: string;
  createdAt: Date;
}

export interface HistoryWaste {
  id: string;
  lotId: string;
  quantity: number;
  reason: string;
  userId: string;
  createdAt: Date;
}

export interface HistoryPlan {
  orders: HistoryOrder[];
  items: HistoryItem[];
  history: HistoryStatusRow[];
  /** Existing EXIT_DISPATCH movements that now belong to an order. */
  links: { movementId: string; orderId: string }[];
  waste: HistoryWaste[];
}

const NOTE = 'seed:history';
const WASTE_REASON = 'Merma: producto deteriorado (datos demo)';
const PRIORITIES: readonly OrderPriority[] = ['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'URGENT'];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Countable units are whole; weights and volumes keep one decimal. */
function roundFor(unit: Unit, value: number): number {
  return unit === 'UNIT' || unit === 'BOX'
    ? Math.max(1, Math.floor(value))
    : Math.max(0.1, Math.floor(value * 10) / 10);
}

function shuffled<T>(items: readonly T[], random: Random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = random.int(0, i);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/**
 * Groups the historical dispatches of each business day into orders of 1 to
 * 3 different products, taking days in turn so the orders spread over the
 * whole window, until `target` orders exist.
 */
function groupDispatches(
  dispatches: readonly HistoryDispatch[],
  timeZone: string,
  target: number,
  random: Random,
): HistoryDispatch[][] {
  const byDay = new Map<CalendarDate, HistoryDispatch[]>();
  for (const dispatch of [...dispatches].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )) {
    const day = todayIn(timeZone, dispatch.createdAt);
    byDay.set(day, [...(byDay.get(day) ?? []), dispatch]);
  }
  const queues = [...byDay.values()].map((day) => shuffled(day, random));
  const groups: HistoryDispatch[][] = [];
  while (groups.length < target && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      if (groups.length >= target) break;
      const size = random.int(1, 3);
      const group: HistoryDispatch[] = [];
      for (let i = 0; i < queue.length && group.length < size;) {
        const candidate = queue[i];
        if (!candidate) break;
        if (group.some((taken) => taken.productId === candidate.productId)) {
          i += 1;
          continue;
        }
        group.push(candidate);
        queue.splice(i, 1);
      }
      if (group.length > 0) groups.push(group);
    }
  }
  return groups;
}

/**
 * Plans the delivery history of the demo, pure apart from ids:
 * - About 60 DELIVERED orders over the last 30 days. Each one is made of
 *   EXIT_DISPATCH movements that already happened (same day, different
 *   products), so stock does not change: the movements are only linked to
 *   their order. Items request and allocate exactly what was dispatched.
 * - History PENDING → IN_PREPARATION → READY_FOR_DISPATCH → SHIPPED (at the
 *   last dispatch) → DELIVERED (2 to 6 hours later), always in that order.
 * - About 80 % on time: due date on or after the delivery day; the rest one
 *   or two days before it (never before the order was created).
 * - A few EXIT_WASTE movements in the last week, from the lots with stock
 *   that expire first, never more than a third of a lot.
 */
export function buildDeliveryHistory({
  customerIds,
  dispatches,
  stockLots,
  today,
  now,
  timeZone,
  adminId,
  operatorId,
  targetOrders = 60,
  onTimeRate = 0.8,
  wasteMovements = 6,
  seed = 6060,
  newId = randomUUID,
}: HistoryInput): HistoryPlan {
  const random = createRandom(seed);
  const plan: HistoryPlan = { orders: [], items: [], history: [], links: [], waste: [] };
  const groups =
    customerIds.length > 0 ? groupDispatches(dispatches, timeZone, targetOrders, random) : [];
  const late = new Set(
    shuffled(
      groups.map((_, index) => index),
      random,
    ).slice(0, Math.round(groups.length * (1 - onTimeRate))),
  );

  groups.forEach((group, index) => {
    const orderId = newId();
    const shippedAt = new Date(Math.max(...group.map((d) => d.createdAt.getTime())));
    const deliveredAt = new Date(
      Math.min(shippedAt.getTime() + random.int(2, 6) * HOUR, now.getTime() - HOUR),
    );
    const createdAt = new Date(shippedAt.getTime() - random.int(2, 4) * DAY);
    const deliveredDay = todayIn(timeZone, deliveredAt);
    const createdDay = todayIn(timeZone, createdAt);
    const lateDue = addDays(deliveredDay, -random.int(1, 2));
    const dueDate = late.has(index)
      ? lateDue < createdDay
        ? createdDay
        : lateDue
      : addDays(deliveredDay, random.int(0, 2));

    plan.orders.push({
      id: orderId,
      customerId: customerIds[random.int(0, customerIds.length - 1)] ?? '',
      status: 'DELIVERED',
      priority: PRIORITIES[random.int(0, PRIORITIES.length - 1)] ?? 'MEDIUM',
      dueDate,
      createdById: adminId,
      createdAt,
      updatedAt: deliveredAt,
    });

    const byProduct = new Map<string, number>();
    for (const dispatch of group) {
      byProduct.set(
        dispatch.productId,
        Math.round(((byProduct.get(dispatch.productId) ?? 0) + dispatch.quantity) * 1000) / 1000,
      );
      plan.links.push({ movementId: dispatch.id, orderId });
    }
    for (const [productId, quantity] of byProduct) {
      plan.items.push({ id: newId(), orderId, productId, quantity });
    }

    const preparedAt = new Date(createdAt.getTime() + random.int(2, 20) * HOUR);
    const readyAt = new Date(shippedAt.getTime() - random.int(1, 3) * HOUR);
    const steps: [OrderStatus | null, OrderStatus, string, Date][] = [
      [null, 'PENDING', adminId, createdAt],
      ['PENDING', 'IN_PREPARATION', operatorId, preparedAt],
      [
        'IN_PREPARATION',
        'READY_FOR_DISPATCH',
        operatorId,
        readyAt > preparedAt ? readyAt : preparedAt,
      ],
      ['READY_FOR_DISPATCH', 'SHIPPED', operatorId, shippedAt],
      ['SHIPPED', 'DELIVERED', operatorId, deliveredAt],
    ];
    for (const [fromStatus, toStatus, userId, at] of steps) {
      plan.history.push({
        id: newId(),
        orderId,
        fromStatus,
        toStatus,
        userId,
        note: NOTE,
        createdAt: at,
      });
    }
  });

  const candidates = [...stockLots]
    .filter((lot) => lot.quantity > 0)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
    .slice(0, wasteMovements);
  candidates.forEach((lot, index) => {
    const quantity = roundFor(lot.unit, lot.quantity * random.between(0.1, 1 / 3));
    if (quantity > lot.quantity) return;
    const day = addDays(today, -(1 + (index % 6)));
    plan.waste.push({
      id: newId(),
      lotId: lot.id,
      quantity,
      reason: WASTE_REASON,
      userId: adminId,
      // 15:00 UTC = 10:00 in Bogota.
      createdAt: new Date(`${day}T15:00:00.000Z`),
    });
  });

  return plan;
}

export interface HistorySeedStore {
  countDelivered(): Promise<number>;
  activeCustomerIds(): Promise<string[]>;
  /** EXIT_DISPATCH movements with no order since `since`. */
  unlinkedDispatches(since: Date): Promise<HistoryDispatch[]>;
  stockLots(): Promise<HistoryStockLot[]>;
  /** Orders, items, history, links and waste (lot quantities go down) in one transaction. */
  apply(plan: HistoryPlan): Promise<void>;
}

export type HistorySeedResult =
  | { seeded: false; reason: 'ALREADY_DELIVERED'; delivered: number }
  | {
      seeded: true;
      orders: number;
      onTime: number;
      items: number;
      history: number;
      linkedDispatches: number;
      waste: number;
    };

/**
 * Idempotent: does nothing when any DELIVERED order exists (a real history,
 * or this seed already ran).
 */
export async function seedHistory(
  store: HistorySeedStore,
  input: Omit<HistoryInput, 'customerIds' | 'dispatches' | 'stockLots'>,
): Promise<HistorySeedResult> {
  const delivered = await store.countDelivered();
  if (delivered > 0) return { seeded: false, reason: 'ALREADY_DELIVERED', delivered };

  const since = new Date(`${addDays(input.today, -30)}T05:00:00.000Z`);
  const plan = buildDeliveryHistory({
    ...input,
    customerIds: await store.activeCustomerIds(),
    dispatches: await store.unlinkedDispatches(since),
    stockLots: await store.stockLots(),
  });
  await store.apply(plan);
  const deliveredOn = new Map(
    plan.history.filter((h) => h.toStatus === 'DELIVERED').map((h) => [h.orderId, h.createdAt]),
  );
  return {
    seeded: true,
    orders: plan.orders.length,
    onTime: plan.orders.filter(
      (order) => order.dueDate >= todayIn(input.timeZone, deliveredOn.get(order.id) ?? input.now),
    ).length,
    items: plan.items.length,
    history: plan.history.length,
    linkedDispatches: plan.links.length,
    waste: plan.waste.length,
  };
}
