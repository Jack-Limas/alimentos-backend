import type { PrismaClient } from '@prisma/client';
import type { DemoRefreshStore } from './demo-refresh.store.js';
import { DEMO_ANCHOR_KEY, planRefresh } from './refresh-plan.js';

/**
 * Key of the transaction-level advisory lock that serializes demo refreshes
 * across requests and processes. Arbitrary but fixed ("AIQDEMO" in ASCII).
 */
export const DEMO_REFRESH_LOCK_KEY = 0x4149_5144_454d_4fn;

/**
 * Moves the whole demo forward in plain SQL, in one interactive transaction
 * that first takes `pg_advisory_xact_lock` (released at commit/rollback):
 * - Lots: expiry date and reception (all of them, also the emptied ones, so
 *   "rescued" in /public/impact keeps comparing each dispatch with its lot).
 * - Orders: due date and creation (active ones stay due in the same number
 *   of days; delivered ones stay on time or late).
 * - Status history and movements: their timestamps.
 * The anchor is read and written under the same lock, so two refreshes at
 * the same time never move the data twice. Audit logs and proposals are
 * records of what happened and are not touched.
 */
export function createPrismaDemoRefreshStore(prisma: PrismaClient): DemoRefreshStore {
  return {
    refreshTo: (today, { fromArg } = {}) =>
      prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DEMO_REFRESH_LOCK_KEY})`;
          const stored = await tx.appMeta.findUnique({ where: { key: DEMO_ANCHOR_KEY } });
          const plan = planRefresh({ stored: stored?.value ?? null, fromArg, today });
          const writeAnchor = () =>
            tx.appMeta.upsert({
              where: { key: DEMO_ANCHOR_KEY },
              create: { key: DEMO_ANCHOR_KEY, value: today },
              update: { value: today },
            });

          if (plan.action === 'refuse') return plan;
          if (plan.action === 'none') {
            // No anchor yet: store today and move nothing (safe by default).
            if (!stored) {
              await writeAnchor();
              return { action: 'anchored', today };
            }
            return { action: 'none', today };
          }
          const { days } = plan;
          const lots = await tx.$executeRaw`UPDATE "inventory_lots"
            SET "expiryDate" = "expiryDate" + ${days}::int,
                "receivedAt" = "receivedAt" + make_interval(days => ${days}::int)`;
          const orders = await tx.$executeRaw`UPDATE "orders"
            SET "dueDate" = "dueDate" + ${days}::int,
                "createdAt" = "createdAt" + make_interval(days => ${days}::int)`;
          const history = await tx.$executeRaw`UPDATE "order_status_history"
            SET "createdAt" = "createdAt" + make_interval(days => ${days}::int)`;
          const movements = await tx.$executeRaw`UPDATE "inventory_movements"
            SET "createdAt" = "createdAt" + make_interval(days => ${days}::int)`;
          await writeAnchor();
          return {
            action: 'shift',
            days,
            from: plan.from,
            counts: { lots, orders, history, movements },
          };
        },
        // A few thousand rows on Neon: give it time, the request never waits for it anyway.
        { timeout: 60_000, maxWait: 30_000 },
      ),
  };
}
