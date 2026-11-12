import { AUDIT_ACTIONS, type AuditService } from '../audit/index.js';
import { todayIn, type CalendarDate } from '../inventory/domain/index.js';
import type { Clock } from '../../shared/clock.js';
import type { CorrectionResult, DemoRefreshStore } from './demo-refresh.store.js';
import { planCorrection, type RefreshResult } from './refresh-plan.js';

export type DemoRefreshTrigger = 'login' | 'public-impact' | 'script';

export type CorrectionOutcome =
  ({ ok: true } & CorrectionResult) | { ok: false; reason: 'NOT_AN_INTEGER' | 'ZERO' | 'TOO_FAR' };

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
   * seed:refresh-demo --shift-days=N: moves the demo by exactly N days (may be
   * negative) and leaves today as the anchor, so the next daily refresh moves
   * only from today. Validates N first (integer, not 0, |N| <= 120). With
   * dryRun nothing is written and nothing is audited.
   */
  correct(rawDays: string, options: { dryRun: boolean }): Promise<CorrectionOutcome>;
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

    async correct(rawDays, { dryRun }) {
      const plan = planCorrection(rawDays);
      if (!plan.ok) return plan;
      const today = todayIn(timeZone, clock());
      const result = await store.correctBy(plan.days, today, { dryRun });
      if (!dryRun) {
        // A correction is not the daily refresh: the in-memory doneFor is untouched,
        // and the next refresh finds today's anchor (nothing to move until tomorrow).
        await audit.record({
          userId: null,
          action: AUDIT_ACTIONS.DEMO_REFRESHED,
          entity: 'Demo',
          entityId: null,
          metadata: { trigger: 'correction', days: plan.days, anchored: today, ...result.counts },
          ip: null,
        });
      }
      return { ok: true, ...result };
    },

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
