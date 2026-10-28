import {
  compareFefo,
  daysBetween,
  fromMilli,
  toMilli,
  type CalendarDate,
} from '../../inventory/domain/index.js';
import type { SnapshotLot } from './snapshot.js';

/**
 * A lot can be dispatched only if it expires tomorrow or later: goods that
 * expire today would reach the customer already expired (or on the last day),
 * so they are left for waste or same-day use instead of being shipped.
 */
export const MIN_DAYS_TO_DISPATCH = 1;

export function isDispatchable(expiryDate: CalendarDate, today: CalendarDate): boolean {
  return daysBetween(today, expiryDate) >= MIN_DAYS_TO_DISPATCH;
}

interface BookLot {
  id: string;
  productId: string;
  expiryDate: CalendarDate;
  receivedAt: Date;
}

/**
 * Remaining stock while a proposal is being built: dispatchable lots per
 * product in FEFO order and a Map<lotId, remaining> (in milli units) that each
 * allocation decrements. Taking stock changes which lot is "next" for the
 * orders still waiting, which is what makes their scores change.
 */
export class LotBook {
  private readonly byProduct = new Map<string, BookLot[]>();
  private readonly remainingMilli = new Map<string, number>();

  constructor(lots: readonly SnapshotLot[], today: CalendarDate) {
    const usable = lots
      .filter((lot) => toMilli(lot.quantity) > 0 && isDispatchable(lot.expiryDate, today))
      .map((lot) => ({
        id: lot.id,
        productId: lot.productId,
        quantity: lot.quantity,
        expiryDate: lot.expiryDate,
        receivedAt: new Date(lot.receivedAt),
      }))
      .sort(compareFefo);
    for (const lot of usable) {
      this.remainingMilli.set(lot.id, toMilli(lot.quantity));
      const list = this.byProduct.get(lot.productId) ?? [];
      list.push(lot);
      this.byProduct.set(lot.productId, list);
    }
  }

  /** Lots of a product with stock left, in FEFO order. */
  lotsOf(productId: string): { id: string; quantity: number; expiryDate: CalendarDate }[] {
    return (this.byProduct.get(productId) ?? [])
      .filter((lot) => (this.remainingMilli.get(lot.id) ?? 0) > 0)
      .map((lot) => ({
        id: lot.id,
        quantity: fromMilli(this.remainingMilli.get(lot.id) ?? 0),
        expiryDate: lot.expiryDate,
      }));
  }

  /** The lot FEFO would take from right now, or null without stock. */
  nextLot(productId: string): { id: string; expiryDate: CalendarDate } | null {
    return this.lotsOf(productId)[0] ?? null;
  }

  available(productId: string): number {
    return fromMilli(
      (this.byProduct.get(productId) ?? []).reduce(
        (sum, lot) => sum + (this.remainingMilli.get(lot.id) ?? 0),
        0,
      ),
    );
  }

  take(lotId: string, qty: number): void {
    const left = (this.remainingMilli.get(lotId) ?? 0) - toMilli(qty);
    if (left < 0) throw new RangeError(`lot ${lotId} does not have ${qty}`);
    this.remainingMilli.set(lotId, left);
  }

  expiryOf(lotId: string, productId: string): CalendarDate | null {
    return this.byProduct.get(productId)?.find((lot) => lot.id === lotId)?.expiryDate ?? null;
  }
}
