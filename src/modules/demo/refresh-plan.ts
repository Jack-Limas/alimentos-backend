import {
  addDays,
  daysBetween,
  isCalendarDate,
  type CalendarDate,
} from '../inventory/domain/index.js';

/** app_meta key of the business day the demo data is "fresh" for. */
export const DEMO_ANCHOR_KEY = 'demo_anchor_date';

/** Reads `--anchor=YYYY-MM-DD` (or `--anchor YYYY-MM-DD`) from the CLI arguments. */
export function parseAnchorArg(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const value = arg.startsWith('--anchor=')
      ? arg.slice('--anchor='.length)
      : arg === '--anchor'
        ? (argv[i + 1] ?? '')
        : null;
    // An empty value is the same as no value.
    if (value !== null) return value.trim() === '' ? undefined : value.trim();
  }
  return undefined;
}

export type RefreshPlan =
  | { action: 'shift'; days: number; from: CalendarDate }
  | { action: 'none'; reason: 'SAME_DAY' }
  | { action: 'refuse'; reason: 'ANCHOR_IN_FUTURE' | 'INVALID_ANCHOR' };

/**
 * How many days to move the demo forward: from the stored anchor (or, the
 * first time, the date given with --anchor, else today) to today. The same
 * day twice gives 0: running it again changes nothing.
 */
export function planRefresh({
  stored,
  fromArg,
  today,
}: {
  stored: string | null;
  fromArg: string | undefined;
  today: CalendarDate;
}): RefreshPlan {
  const anchor = stored ?? fromArg ?? today;
  if (!isCalendarDate(anchor)) return { action: 'refuse', reason: 'INVALID_ANCHOR' };
  const days = daysBetween(anchor, today);
  if (days < 0) return { action: 'refuse', reason: 'ANCHOR_IN_FUTURE' };
  if (days === 0) return { action: 'none', reason: 'SAME_DAY' };
  return { action: 'shift', days, from: anchor };
}

export interface RefreshCounts {
  lots: number;
  orders: number;
  history: number;
  movements: number;
}

export type RefreshResult =
  | { action: 'shift'; days: number; from: CalendarDate; counts: RefreshCounts }
  | { action: 'anchored' | 'none'; today: CalendarDate }
  | { action: 'refuse'; reason: 'ANCHOR_IN_FUTURE' | 'INVALID_ANCHOR' };

/** A correction never moves more than this many days at once (in either direction). */
export const MAX_CORRECTION_DAYS = 120;

/** Reads `--shift-days=N` (or `--shift-days N`); undefined when absent. */
export function parseShiftDaysArg(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg.startsWith('--shift-days=')) return arg.slice('--shift-days='.length).trim();
    if (arg === '--shift-days') return (argv[i + 1] ?? '').trim();
  }
  return undefined;
}

export type CorrectionPlan =
  { ok: true; days: number } | { ok: false; reason: 'NOT_AN_INTEGER' | 'ZERO' | 'TOO_FAR' };

/** --shift-days must be a whole number of days, not 0, at most MAX_CORRECTION_DAYS away. */
export function planCorrection(raw: string): CorrectionPlan {
  if (!/^[+-]?\d+$/.test(raw)) return { ok: false, reason: 'NOT_AN_INTEGER' };
  const days = Number(raw);
  if (days === 0) return { ok: false, reason: 'ZERO' };
  if (Math.abs(days) > MAX_CORRECTION_DAYS) return { ok: false, reason: 'TOO_FAR' };
  return { ok: true, days };
}

/** The same snapshot `days` later: what a dry run reports as "after" without writing. */
export function shiftSnapshot<
  T extends {
    stockExpiry: { min: CalendarDate | null; max: CalendarDate | null };
    activeDue: { min: CalendarDate | null; max: CalendarDate | null };
    lastMovementAt: Date | null;
  },
>(snapshot: T, days: number): T {
  const day = (date: CalendarDate | null) => (date === null ? null : addDays(date, days));
  return {
    ...snapshot,
    stockExpiry: { min: day(snapshot.stockExpiry.min), max: day(snapshot.stockExpiry.max) },
    activeDue: { min: day(snapshot.activeDue.min), max: day(snapshot.activeDue.max) },
    lastMovementAt:
      snapshot.lastMovementAt === null
        ? null
        : new Date(snapshot.lastMovementAt.getTime() + days * 86_400_000),
  };
}
