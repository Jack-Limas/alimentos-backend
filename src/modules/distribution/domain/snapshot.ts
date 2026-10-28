import type { CalendarDate } from '../../inventory/domain/index.js';

/**
 * Everything the engine needs, as plain JSON (no Prisma, no Date objects), so
 * the same snapshot runs on the server and in the browser Web Worker and the
 * parity fixtures can be shared as files.
 */
export type OrderPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface SnapshotItem {
  id: string;
  productId: string;
  requestedQty: number;
}

export interface SnapshotOrder {
  id: string;
  number: number;
  priority: OrderPriority;
  dueDate: CalendarDate;
  /** ISO instant; older orders win ties. */
  createdAt: string;
  items: SnapshotItem[];
}

export interface SnapshotLot {
  id: string;
  productId: string;
  quantity: number;
  expiryDate: CalendarDate;
  /** ISO instant; FEFO tie-breaker between lots with the same expiry date. */
  receivedAt: string;
}

export interface SnapshotProduct {
  id: string;
  unit: 'KG' | 'L' | 'UNIT' | 'BOX';
  avgDailyOut30d: number;
}

export interface DistributionSnapshot {
  /** Business date in APP_TIMEZONE; every day count is relative to it. */
  businessDate: CalendarDate;
  orders: SnapshotOrder[];
  lots: SnapshotLot[];
  products: SnapshotProduct[];
}
