import { daysBetween, type CalendarDate } from './calendar.js';
import { fromMilli, toMilli } from './quantity.js';

export interface FefoLot {
  id: string;
  quantity: number;
  expiryDate: CalendarDate;
  /** Tie-breaker between lots with the same expiry date: older first. */
  receivedAt?: Date;
}

export interface FefoAllocation {
  lotId: string;
  qty: number;
}

export interface FefoResult {
  allocations: FefoAllocation[];
  allocatedQty: number;
  /** Requested quantity that no eligible lot could cover (0 when fully covered). */
  shortfall: number;
}

export interface FefoOptions {
  today: CalendarDate;
  /** Expired lots are skipped unless this is true (e.g. to write off waste). */
  includeExpired?: boolean;
}

export function isExpired(expiryDate: CalendarDate, today: CalendarDate): boolean {
  return daysBetween(today, expiryDate) < 0;
}

/** First expired, first out; then oldest received; then id, so the order is deterministic. */
export function compareFefo(a: FefoLot, b: FefoLot): number {
  if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1;
  const received = (a.receivedAt?.getTime() ?? 0) - (b.receivedAt?.getTime() ?? 0);
  if (received !== 0) return received;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Takes `qty` from the lots in FEFO order. A lot that expires today is still
 * usable; one that expired yesterday is not (unless `includeExpired`). Pure:
 * the input lots are not modified.
 */
export function allocateFefo(
  lots: readonly FefoLot[],
  qty: number,
  { today, includeExpired = false }: FefoOptions,
): FefoResult {
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new RangeError('qty must be a positive number');
  }

  const requested = toMilli(qty);
  let remaining = requested;
  const allocations: FefoAllocation[] = [];

  const eligible = lots
    .filter((lot) => toMilli(lot.quantity) > 0)
    .filter((lot) => includeExpired || !isExpired(lot.expiryDate, today))
    .sort(compareFefo);

  for (const lot of eligible) {
    if (remaining === 0) break;
    const take = Math.min(remaining, toMilli(lot.quantity));
    allocations.push({ lotId: lot.id, qty: fromMilli(take) });
    remaining -= take;
  }

  return {
    allocations,
    allocatedQty: fromMilli(requested - remaining),
    shortfall: fromMilli(remaining),
  };
}
