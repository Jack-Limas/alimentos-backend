import { startOfDayIn, addDays, todayIn } from '../inventory/domain/index.js';
import type { ReportsRepository } from '../reports/reports.repository.js';
import type { Clock } from '../../shared/clock.js';
import { computeImpact, IMPACT_WINDOW_DAYS, type Impact } from './domain/impact.js';

/** The page is public: a short server-side cache keeps bursts away from the database. */
export const IMPACT_CACHE_MS = 60_000;

export interface ImpactService {
  impact(): Promise<Impact>;
}

export function createImpactService({
  reports,
  clock,
  timeZone,
}: {
  reports: ReportsRepository;
  clock: Clock;
  timeZone: string;
}): ImpactService {
  let cached: { value: Impact; expiresAt: number } | null = null;

  return {
    async impact() {
      const now = clock();
      if (cached && cached.expiresAt > now.getTime()) return cached.value;
      // The last 30 business days, today included.
      const since = startOfDayIn(
        addDays(todayIn(timeZone, now), -(IMPACT_WINDOW_DAYS - 1)),
        timeZone,
      );
      const [dispatches, deliveries] = await Promise.all([
        reports.dispatchesSince(since),
        reports.deliveriesSince(since),
      ]);
      const value = computeImpact({ dispatches, deliveries, now, timeZone });
      cached = { value, expiresAt: now.getTime() + IMPACT_CACHE_MS };
      return value;
    },
  };
}
