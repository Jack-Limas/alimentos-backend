import type { Prisma, PrismaClient } from '@prisma/client';
import { fromDbDate } from '../inventory/domain/index.js';
import type { DemoRefreshStore, DemoSnapshot } from './demo-refresh.store.js';
import { DEMO_ANCHOR_KEY, planRefresh, shiftSnapshot, type RefreshCounts } from './refresh-plan.js';

/**
 * Key of the transaction-level advisory lock that serializes demo refreshes
 * across requests and processes. Arbitrary but fixed ("AIQDEMO" in ASCII).
 */
export const DEMO_REFRESH_LOCK_KEY = 0x4149_5144_454d_4fn;

/** Orders still in play: their due date is what the demo has to keep ahead of today. */
const FINISHED_ORDER_STATUSES = ['DELIVERED', 'CANCELLED'] as const;

/**
 * THE set the demo refresh moves, used by the daily refresh and by the
 * correction alike (so both always move exactly the same rows):
 * - Lots: expiry date and reception (all of them, also the emptied ones, so
 *   "rescued" in /public/impact keeps comparing each dispatch with its lot).
 * - Orders: due date and creation (active ones stay due in the same number
 *   of days; delivered ones stay on time or late).
 * - Status history and movements: their timestamps.
 * `days` may be negative (a correction). Audit logs and proposals are records
 * of what happened and are not touched.
 */
async function shiftAll(tx: Prisma.TransactionClient, days: number): Promise<RefreshCounts> {
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
  return { lots, orders, history, movements };
}

/** The rows shiftAll would move: it has no WHERE, so every row of each table. Read only. */
async function countAll(tx: Prisma.TransactionClient): Promise<RefreshCounts> {
  const [lots, orders, history, movements] = await Promise.all([
    tx.inventoryLot.count(),
    tx.order.count(),
    tx.orderStatusHistory.count(),
    tx.inventoryMovement.count(),
  ]);
  return { lots, orders, history, movements };
}

/** What the demo looks like now: read only. */
async function snapshotOf(tx: Prisma.TransactionClient): Promise<DemoSnapshot> {
  const [lots, orders, movements] = await Promise.all([
    tx.inventoryLot.aggregate({
      where: { quantity: { gt: 0 } },
      _min: { expiryDate: true },
      _max: { expiryDate: true },
    }),
    tx.order.aggregate({
      where: { status: { notIn: [...FINISHED_ORDER_STATUSES] } },
      _min: { dueDate: true },
      _max: { dueDate: true },
    }),
    tx.inventoryMovement.aggregate({ _max: { createdAt: true } }),
  ]);
  const day = (date: Date | null) => (date ? fromDbDate(date) : null);
  return {
    stockExpiry: { min: day(lots._min.expiryDate), max: day(lots._max.expiryDate) },
    activeDue: { min: day(orders._min.dueDate), max: day(orders._max.dueDate) },
    lastMovementAt: movements._max.createdAt,
  };
}

/**
 * Every operation runs in one interactive transaction that first takes
 * `pg_advisory_xact_lock` (released at commit/rollback): the anchor is read,
 * the data moved and the anchor written under the same lock, so concurrent
 * refreshes (or a refresh and a correction) never move the data twice.
 */
export function createPrismaDemoRefreshStore(prisma: PrismaClient): DemoRefreshStore {
  const locked = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DEMO_REFRESH_LOCK_KEY})`;
        return work(tx);
      },
      // A few thousand rows on Neon: give it time, a request never waits for it anyway.
      { timeout: 60_000, maxWait: 30_000 },
    );
  const writeAnchor = (tx: Prisma.TransactionClient, today: string) =>
    tx.appMeta.upsert({
      where: { key: DEMO_ANCHOR_KEY },
      create: { key: DEMO_ANCHOR_KEY, value: today },
      update: { value: today },
    });

  return {
    refreshTo: (today, { fromArg } = {}) =>
      locked(async (tx) => {
        const stored = await tx.appMeta.findUnique({ where: { key: DEMO_ANCHOR_KEY } });
        const plan = planRefresh({ stored: stored?.value ?? null, fromArg, today });
        if (plan.action === 'refuse') return plan;
        if (plan.action === 'none') {
          // No anchor yet: store today and move nothing (safe by default).
          if (!stored) {
            await writeAnchor(tx, today);
            return { action: 'anchored', today };
          }
          return { action: 'none', today };
        }
        const counts = await shiftAll(tx, plan.days);
        await writeAnchor(tx, today);
        return { action: 'shift', days: plan.days, from: plan.from, counts };
      }),

    correctBy: (days, today, { dryRun }) =>
      locked(async (tx) => {
        const before = await snapshotOf(tx);
        if (dryRun) {
          // Read only: what would move, and the same dates N days later. Nothing is written.
          return {
            days,
            dryRun: true,
            counts: await countAll(tx),
            before,
            after: shiftSnapshot(before, days),
          };
        }
        const counts = await shiftAll(tx, days);
        await writeAnchor(tx, today);
        return { days, dryRun: false, counts, before, after: await snapshotOf(tx) };
      }),
  };
}
