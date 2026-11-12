import type { CalendarDate } from '../inventory/domain/index.js';
import type { RefreshCounts, RefreshResult } from './refresh-plan.js';

/** The demo's dates at one moment, to compare a correction before and after. */
export interface DemoSnapshot {
  /** Lots with stock: earliest and latest expiry. */
  stockExpiry: { min: CalendarDate | null; max: CalendarDate | null };
  /** Orders not DELIVERED or CANCELLED: earliest and latest due date. */
  activeDue: { min: CalendarDate | null; max: CalendarDate | null };
  /** The latest movement (it must not be in the future). */
  lastMovementAt: Date | null;
}

export interface CorrectionResult {
  days: number;
  dryRun: boolean;
  /** Rows moved (or that would move, with dryRun). */
  counts: RefreshCounts;
  before: DemoSnapshot;
  after: DemoSnapshot;
}

export interface DemoRefreshStore {
  /**
   * Brings the demo to `today` in ONE transaction that holds an exclusive
   * lock: reads the anchor, applies planRefresh and stores the new anchor.
   * Two calls at the same time run one after the other, so the second sees
   * today's anchor and moves nothing. Without an anchor (and no `fromArg`) it
   * only stores today: nothing moves.
   */
  refreshTo(
    today: CalendarDate,
    options?: { fromArg?: string | undefined },
  ): Promise<RefreshResult>;
  /**
   * Correction: moves the same set as refreshTo by exactly `days` (may be
   * negative), under the same lock, and stores `today` as the anchor. With
   * `dryRun` it only reads: counts and the before/after dates, no writes.
   */
  correctBy(
    days: number,
    today: CalendarDate,
    options: { dryRun: boolean },
  ): Promise<CorrectionResult>;
}
