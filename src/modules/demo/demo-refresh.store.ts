import type { CalendarDate } from '../inventory/domain/index.js';
import type { RefreshResult } from './refresh-plan.js';

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
}
