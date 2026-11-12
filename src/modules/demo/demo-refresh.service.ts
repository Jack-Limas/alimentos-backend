import { AUDIT_ACTIONS, type AuditService } from '../audit/index.js';
import { todayIn, type CalendarDate } from '../inventory/domain/index.js';
import type { Clock } from '../../shared/clock.js';
import type { DemoRefreshStore } from './demo-refresh.store.js';
import type { RefreshResult } from './refresh-plan.js';

export type DemoRefreshTrigger = 'login' | 'public-impact' | 'script';

/** After a failed lazy refresh, wait this long before trying again (not on every request). */
export const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

interface Logger {
  info(object: object, message: string): void;
  error(object: object, message: string): void;
}

export interface DemoRefreshServiceDeps {
  store: DemoRefreshStore;
  audit: AuditService;
  clock: Clock;
  /** APP_TIMEZONE: the business day changes at midnight there, not in UTC. */
  timeZone: string;
  log: Logger;
}

export interface DemoRefreshService {
  /** seed:refresh-demo: always runs, returns the result, throws on failure. */
  run(options?: { fromArg?: string | undefined }): Promise<RefreshResult>;
  /**
   * The lazy daily refresh (DEMO_DAILY_REFRESH=true): called after a request
   * was answered. At most once per business day per process (and the store's
   * lock makes it once per day across processes). Never throws: a failure is
   * logged and retried after RETRY_AFTER_FAILURE_MS.
   */
  refreshIfDue(trigger: Exclude<DemoRefreshTrigger, 'script'>): void;
  /** Resolves when the lazy refresh in progress (if any) is over. For tests and shutdown. */
  settled(): Promise<void>;
}

export function createDemoRefreshService({
  store,
  audit,
  clock,
  timeZone,
  log,
}: DemoRefreshServiceDeps): DemoRefreshService {
  let doneFor: CalendarDate | null = null;
  let failedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;

  async function refresh(
    today: CalendarDate,
    trigger: DemoRefreshTrigger,
    fromArg?: string,
  ): Promise<RefreshResult> {
    const result = await store.refreshTo(today, { fromArg });
    if (result.action === 'shift' || result.action === 'anchored') {
      await audit.record({
        userId: null,
        action: AUDIT_ACTIONS.DEMO_REFRESHED,
        entity: 'Demo',
        entityId: null,
        metadata:
          result.action === 'shift'
            ? { trigger, days: result.days, from: result.from, to: today, ...result.counts }
            : { trigger, days: 0, anchored: today },
        ip: null,
      });
    }
    return result;
  }

  return {
    run: ({ fromArg } = {}) => refresh(todayIn(timeZone, clock()), 'script', fromArg),

    refreshIfDue(trigger) {
      const now = clock();
      const today = todayIn(timeZone, now);
      if (doneFor === today || inFlight) return;
      if (now.getTime() - failedAt < RETRY_AFTER_FAILURE_MS) return;
      inFlight = refresh(today, trigger)
        .then((result) => {
          doneFor = today;
          if (result.action !== 'none') {
            log.info({ demoRefresh: { trigger, ...result } }, 'Demo data refreshed for the day');
          }
        })
        .catch((error: unknown) => {
          failedAt = now.getTime();
          log.error({ err: error, demoRefresh: { trigger } }, 'Demo daily refresh failed');
        })
        .finally(() => {
          inFlight = null;
        });
    },

    settled: () => inFlight ?? Promise.resolve(),
  };
}
