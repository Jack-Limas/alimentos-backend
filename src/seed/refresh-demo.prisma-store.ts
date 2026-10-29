import type { PrismaClient } from '@prisma/client';
import { DEMO_ANCHOR_KEY, type RefreshDemoStore } from './refresh-demo.js';

/**
 * Moves the whole demo forward in plain SQL, in one transaction:
 * - Lots: expiry date and reception (all of them, also the emptied ones, so
 *   "rescued" in /public/impact keeps comparing each dispatch with its lot).
 * - Orders: due date and creation (active ones stay due in the same number
 *   of days; delivered ones stay on time or late).
 * - Status history and movements: their timestamps.
 * Audit logs and proposals are records of what happened and are not touched.
 */
export function createPrismaRefreshDemoStore(prisma: PrismaClient): RefreshDemoStore {
  const writeAnchor = (today: string) =>
    prisma.appMeta.upsert({
      where: { key: DEMO_ANCHOR_KEY },
      create: { key: DEMO_ANCHOR_KEY, value: today },
      update: { value: today },
    });

  return {
    async readAnchor() {
      const row = await prisma.appMeta.findUnique({ where: { key: DEMO_ANCHOR_KEY } });
      return row?.value ?? null;
    },

    async writeAnchor(today) {
      await writeAnchor(today);
    },

    async shiftAndAnchor(days, today) {
      const [lots, orders, history, movements] = await prisma.$transaction([
        prisma.$executeRaw`UPDATE "inventory_lots"
          SET "expiryDate" = "expiryDate" + ${days}::int,
              "receivedAt" = "receivedAt" + make_interval(days => ${days}::int)`,
        prisma.$executeRaw`UPDATE "orders"
          SET "dueDate" = "dueDate" + ${days}::int,
              "createdAt" = "createdAt" + make_interval(days => ${days}::int)`,
        prisma.$executeRaw`UPDATE "order_status_history"
          SET "createdAt" = "createdAt" + make_interval(days => ${days}::int)`,
        prisma.$executeRaw`UPDATE "inventory_movements"
          SET "createdAt" = "createdAt" + make_interval(days => ${days}::int)`,
        writeAnchor(today),
      ]);
      return { lots, orders, history, movements };
    },
  };
}
