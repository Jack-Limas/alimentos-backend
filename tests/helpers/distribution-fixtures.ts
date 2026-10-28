import { addDays } from '../../src/modules/inventory/domain/index.js';
import type {
  DistributionSnapshot,
  OrderPriority,
  SnapshotLot,
  SnapshotOrder,
} from '../../src/modules/distribution/domain/index.js';

export const TODAY = '2026-10-28';

export function order(
  number: number,
  priority: OrderPriority,
  dueInDays: number,
  items: [productId: string, qty: number][],
  createdAt = `2026-10-2${String(number % 8)}T12:00:00.000Z`,
): SnapshotOrder {
  return {
    id: `order-${String(number)}`,
    number,
    priority,
    dueDate: addDays(TODAY, dueInDays),
    createdAt,
    items: items.map(([productId, requestedQty], index) => ({
      id: `item-${String(number)}-${String(index + 1)}`,
      productId,
      requestedQty,
    })),
  };
}

export function lot(
  id: string,
  productId: string,
  quantity: number,
  expiresInDays: number,
): SnapshotLot {
  return {
    id,
    productId,
    quantity,
    expiryDate: addDays(TODAY, expiresInDays),
    receivedAt: '2026-10-20T12:00:00.000Z',
  };
}

export function snapshot(
  orders: SnapshotOrder[],
  lots: SnapshotLot[],
  productIds: string[] = [...new Set(lots.map((l) => l.productId))],
): DistributionSnapshot {
  return {
    businessDate: TODAY,
    orders,
    lots,
    products: productIds.map((id) => ({ id, unit: 'KG' as const, avgDailyOut30d: 1 })),
  };
}

/** Fixed clock: processingMs is always 0, so results compare exactly. */
export const fixedClock = { now: () => 0 };
