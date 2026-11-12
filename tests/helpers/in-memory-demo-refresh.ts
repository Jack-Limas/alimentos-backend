import type { DemoRefreshStore } from '../../src/modules/demo/index.js';
import type { CorrectionResult, DemoSnapshot } from '../../src/modules/demo/index.js';
import { planRefresh, shiftSnapshot } from '../../src/modules/demo/index.js';

/**
 * In-memory DemoRefreshStore with the guarantee of the Prisma one: calls run
 * one at a time (like pg_advisory_xact_lock), so concurrent refreshes see each
 * other's anchor. `shifts` records the days moved; `fail` makes the next call
 * throw (a database error). `snapshot` stands for the demo's dates: a real
 * correction moves it, a dry run only reports it moved.
 */
export function createInMemoryDemoRefreshStore() {
  let queue: Promise<unknown> = Promise.resolve();
  const store = {
    anchor: null as string | null,
    shifts: [] as number[],
    calls: 0,
    fail: false,
    snapshot: {
      stockExpiry: { min: '2026-11-15', max: '2027-02-10' },
      activeDue: { min: '2026-11-13', max: '2026-11-30' },
      lastMovementAt: new Date('2026-11-12T15:00:00.000Z'),
    } as DemoSnapshot,
    refreshTo(today, { fromArg } = {}) {
      const run = queue.then(async () => {
        store.calls += 1;
        // Give a concurrent caller the chance to interleave if there were no lock.
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (store.fail) throw new Error('database unreachable');
        const plan = planRefresh({ stored: store.anchor, fromArg, today });
        if (plan.action === 'refuse') return plan;
        if (plan.action === 'none') {
          if (store.anchor === null) {
            store.anchor = today;
            return { action: 'anchored' as const, today };
          }
          return { action: 'none' as const, today };
        }
        store.shifts.push(plan.days);
        store.anchor = today;
        return {
          action: 'shift' as const,
          days: plan.days,
          from: plan.from,
          counts: { lots: 3, orders: 2, history: 5, movements: 8 },
        };
      });
      queue = run.catch(() => undefined);
      return run;
    },
    correctBy(
      days: number,
      today: string,
      { dryRun }: { dryRun: boolean },
    ): Promise<CorrectionResult> {
      const run = queue.then(async () => {
        store.calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (store.fail) throw new Error('database unreachable');
        const before: DemoSnapshot = store.snapshot;
        const after = shiftSnapshot(before, days);
        const counts = { lots: 3, orders: 2, history: 5, movements: 8 };
        if (dryRun) return { days, dryRun: true, counts, before, after };
        store.shifts.push(days);
        store.snapshot = after;
        store.anchor = today;
        return { days, dryRun: false, counts, before, after };
      });
      queue = run.catch(() => undefined);
      return run;
    },
  } satisfies DemoRefreshStore & Record<string, unknown>;
  return store;
}
