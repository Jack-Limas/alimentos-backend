import { daysBetween, type CalendarDate } from './calendar.js';
import { INVENTORY_RULES, type InventoryRules } from './inventory-rules.js';
import { fromMilli, toMilli } from './quantity.js';
import type { Reason } from './reasons.js';

export type StockStatus = 'OK' | 'LOW' | 'OUT';
export type WasteRisk = 'NONE' | 'LOW' | 'HIGH';

/** Stock of one expiry date. A real lot or an aggregate of lots sharing the date. */
export interface MetricsLot {
  quantity: number;
  expiryDate: CalendarDate;
}

export interface MetricsInput {
  minStock: number;
  lots: readonly MetricsLot[];
}

export interface ProductMetrics {
  /** Stock in lots that have not expired. */
  availableQty: number;
  /** Stock still on the shelf in expired lots (only waste can remove it). */
  expiredQty: number;
  /** Earliest expiry among non-expired lots with stock. */
  nearestExpiry: CalendarDate | null;
  daysToNearestExpiry: number | null;
  stockStatus: StockStatus;
  /** EXIT_DISPATCH of the window divided by the window length, in units per day. */
  avgDailyOut30d: number;
  /** Days the available stock lasts at the average outflow; null without outflow. */
  coverageDays: number | null;
  wasteRisk: WasteRisk;
  reasons: Reason[];
}

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Derived figures of a product (contract, ProductDTO). Pure: no clock, no I/O.
 *
 * wasteRisk:
 * - HIGH when there is non-expired stock and either nothing was dispatched in
 *   the window while the nearest lot expires within EXPIRY_WARNING_DAYS, or the
 *   coverage is longer than the days left until that lot expires.
 * - LOW when the nearest lot expires within EXPIRY_WARNING_DAYS.
 * - NONE otherwise.
 */
export function productMetrics(
  { minStock, lots }: MetricsInput,
  outflowInWindow: number,
  today: CalendarDate,
  rules: InventoryRules = INVENTORY_RULES,
): ProductMetrics {
  let availableMilli = 0;
  let expiredMilli = 0;
  let nearestExpiry: CalendarDate | null = null;

  for (const lot of lots) {
    const milli = toMilli(lot.quantity);
    if (milli <= 0) continue;
    if (daysBetween(today, lot.expiryDate) < 0) {
      expiredMilli += milli;
      continue;
    }
    availableMilli += milli;
    if (nearestExpiry === null || lot.expiryDate < nearestExpiry) nearestExpiry = lot.expiryDate;
  }

  const availableQty = fromMilli(availableMilli);
  const expiredQty = fromMilli(expiredMilli);
  const daysToNearestExpiry = nearestExpiry === null ? null : daysBetween(today, nearestExpiry);
  const reasons: Reason[] = [];

  let stockStatus: StockStatus = 'OK';
  if (availableMilli === 0) {
    stockStatus = 'OUT';
    reasons.push({ code: 'OUT_OF_STOCK', params: { minStock } });
  } else if (availableMilli < toMilli(minStock)) {
    stockStatus = 'LOW';
    reasons.push({ code: 'BELOW_MIN_STOCK', params: { availableQty, minStock } });
  }

  const avgDailyOut = Math.max(0, outflowInWindow) / rules.OUTFLOW_WINDOW_DAYS;
  const coverage = avgDailyOut > 0 ? availableQty / avgDailyOut : null;

  let wasteRisk: WasteRisk = 'NONE';
  if (daysToNearestExpiry !== null) {
    const expiresSoon = daysToNearestExpiry <= rules.EXPIRY_WARNING_DAYS;
    if (expiresSoon) {
      reasons.push({ code: 'EXPIRES_IN_DAYS', params: { days: daysToNearestExpiry } });
    }
    if (avgDailyOut === 0 && expiresSoon) {
      wasteRisk = 'HIGH';
      reasons.push({
        code: 'NO_RECENT_OUTFLOW',
        params: { windowDays: rules.OUTFLOW_WINDOW_DAYS },
      });
    } else if (coverage !== null && coverage > daysToNearestExpiry) {
      wasteRisk = 'HIGH';
      reasons.push({
        code: 'COVERAGE_EXCEEDS_EXPIRY',
        params: { coverageDays: round(coverage, 1), daysToExpiry: daysToNearestExpiry },
      });
    } else if (expiresSoon) {
      wasteRisk = 'LOW';
    }
  }

  if (expiredMilli > 0) {
    reasons.push({ code: 'EXPIRED_STOCK', params: { quantity: expiredQty } });
  }

  return {
    availableQty,
    expiredQty,
    nearestExpiry,
    daysToNearestExpiry,
    stockStatus,
    avgDailyOut30d: round(avgDailyOut, 3),
    coverageDays: coverage === null ? null : round(coverage, 1),
    wasteRisk,
    reasons,
  };
}
