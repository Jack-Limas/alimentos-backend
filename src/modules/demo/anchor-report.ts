import { daysBetween, todayIn, type CalendarDate } from '../inventory/domain/index.js';

/** Earliest createdAt per table, as read by `npm run demo:anchor-report` (read only). */
export interface AnchorFacts {
  products: Date | null;
  lots: Date | null;
  orders: Date | null;
  movements: Date | null;
  /** The anchor already stored in app_meta, if any. */
  anchor: string | null;
}

export type AnchorAdvice =
  | { kind: 'ALREADY_ANCHORED'; anchor: string; behindDays: number }
  | { kind: 'PROPOSE'; anchor: CalendarDate; daysToShift: number }
  | { kind: 'EMPTY' };

/**
 * Which --anchor to pass to the FIRST manual `seed:refresh-demo`: the business
 * day (APP_TIMEZONE) of the earliest products.createdAt, which is the day the
 * seed ran. ONLY products: the seed dates lots (receivedAt/createdAt), orders
 * and movements in the past on purpose (history, expiry), so their earliest
 * dates are weeks or months before the seed and are shown for reference only.
 * With an anchor already stored there is nothing to propose (--anchor would be
 * ignored); the report says how many days behind the data is.
 */
export function adviseAnchor(facts: AnchorFacts, timeZone: string, now: Date): AnchorAdvice {
  const today = todayIn(timeZone, now);
  if (facts.anchor !== null) {
    return {
      kind: 'ALREADY_ANCHORED',
      anchor: facts.anchor,
      behindDays: daysBetween(facts.anchor, today),
    };
  }
  if (facts.products === null) return { kind: 'EMPTY' };
  const anchor = todayIn(timeZone, facts.products);
  return { kind: 'PROPOSE', anchor, daysToShift: Math.max(0, daysBetween(anchor, today)) };
}
