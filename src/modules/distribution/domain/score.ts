import { daysBetween, type CalendarDate } from '../../inventory/domain/index.js';
import type { LotBook } from './lot-book.js';
import type { OrderPriority, SnapshotOrder } from './snapshot.js';
import type { Weights } from './weights.js';

export const PRIORITY_VALUE: Readonly<Record<OrderPriority, number>> = Object.freeze({
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
  URGENT: 1,
});

/** deadlineUrgency reaches 1 when the order is due today (or overdue). */
export const DEADLINE_HORIZON_DAYS = 14;
/** expiryPressure reaches 1 when the FEFO lot expires today. */
export const EXPIRY_HORIZON_DAYS = 30;

export type DistributionReasonCode =
  | 'PRIORITY_LOW'
  | 'PRIORITY_MEDIUM'
  | 'PRIORITY_HIGH'
  | 'PRIORITY_URGENT'
  | 'DUE_IN_DAYS'
  | 'OVERDUE'
  | 'EXPIRES_IN_DAYS'
  | 'PARTIAL_STOCK'
  | 'NO_STOCK';

export interface DistributionReason {
  code: DistributionReasonCode;
  params: Record<string, number>;
}

export interface ScoreComponents {
  /** Each component is a factor from 0 to 1, before weighting. */
  priority: number;
  deadlineUrgency: number;
  expiryPressure: number;
}

export interface OrderScore {
  /** 0–100, rounded to 2 decimals. */
  score: number;
  components: ScoreComponents;
  reasons: DistributionReason[];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * score = wP·priority + wD·deadlineUrgency + wE·expiryPressure (contract 4.7).
 * expiryPressure looks at the lot FEFO would take today for each item, with
 * the current state of the lots, so it drops once earlier orders take the
 * lots that were about to expire.
 */
export function scoreOrder(
  order: SnapshotOrder,
  lots: LotBook,
  today: CalendarDate,
  weights: Weights,
): OrderScore {
  const priority = PRIORITY_VALUE[order.priority];
  const daysToDue = daysBetween(today, order.dueDate);
  const deadlineUrgency = clamp01(1 - daysToDue / DEADLINE_HORIZON_DAYS);

  let expiryPressure = 0;
  let pressureDays: number | null = null;
  for (const item of order.items) {
    const lot = lots.nextLot(item.productId);
    if (!lot) continue;
    const days = daysBetween(today, lot.expiryDate);
    const pressure = clamp01(1 - days / EXPIRY_HORIZON_DAYS);
    // Keep the most pressing item (the first one on ties, so the result is stable).
    if (pressureDays === null || pressure > expiryPressure) {
      expiryPressure = pressure;
      pressureDays = days;
    }
  }

  const score = round(
    weights.priority * priority +
      weights.deadlineUrgency * deadlineUrgency +
      weights.expiryPressure * expiryPressure,
    2,
  );

  const reasons: DistributionReason[] = [
    { code: `PRIORITY_${order.priority}`, params: {} },
    daysToDue < 0
      ? { code: 'OVERDUE', params: { days: -daysToDue } }
      : { code: 'DUE_IN_DAYS', params: { days: daysToDue } },
  ];
  if (expiryPressure > 0 && pressureDays !== null) {
    reasons.push({ code: 'EXPIRES_IN_DAYS', params: { days: pressureDays } });
  }

  return {
    score,
    components: {
      priority,
      deadlineUrgency: round(deadlineUrgency, 4),
      expiryPressure: round(expiryPressure, 4),
    },
    reasons,
  };
}
