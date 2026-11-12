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
 * day the demo was seeded. Products and lots are inserted by the seed with the
 * real time, so the earliest of them is the seed day. Orders and movements are
 * not used: the seed dates them in the past on purpose (history, due dates).
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
  const seeded = [facts.products, facts.lots].filter((date): date is Date => date !== null);
  if (seeded.length === 0) return { kind: 'EMPTY' };
  const earliest = new Date(Math.min(...seeded.map((date) => date.getTime())));
  const anchor = todayIn(timeZone, earliest);
  return { kind: 'PROPOSE', anchor, daysToShift: Math.max(0, daysBetween(anchor, today)) };
}
