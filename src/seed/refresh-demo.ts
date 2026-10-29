import {
  daysBetween,
  isCalendarDate,
  type CalendarDate,
} from '../modules/inventory/domain/index.js';

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

export interface RefreshDemoStore {
  readAnchor(): Promise<string | null>;
  /** In one transaction: moves every date `days` forward and stores `today` as the anchor. */
  shiftAndAnchor(days: number, today: CalendarDate): Promise<RefreshCounts>;
  writeAnchor(today: CalendarDate): Promise<void>;
}

export type RefreshResult =
  | { action: 'shift'; days: number; from: CalendarDate; counts: RefreshCounts }
  | { action: 'anchored' | 'none'; today: CalendarDate }
  | { action: 'refuse'; reason: 'ANCHOR_IN_FUTURE' | 'INVALID_ANCHOR' };

/**
 * Moves the demo to today. The first run without --anchor only stores today
 * as the anchor, so the next runs have a base to count from.
 */
export async function refreshDemo(
  store: RefreshDemoStore,
  { today, fromArg }: { today: CalendarDate; fromArg?: string | undefined },
): Promise<RefreshResult> {
  const stored = await store.readAnchor();
  const plan = planRefresh({ stored, fromArg, today });
  if (plan.action === 'refuse') return plan;
  if (plan.action === 'none') {
    if (stored === null) {
      await store.writeAnchor(today);
      return { action: 'anchored', today };
    }
    return { action: 'none', today };
  }
  const counts = await store.shiftAndAnchor(plan.days, today);
  return { action: 'shift', days: plan.days, from: plan.from, counts };
}
