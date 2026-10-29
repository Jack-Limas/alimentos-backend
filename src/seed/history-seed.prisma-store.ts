import type { PrismaClient } from '@prisma/client';
import { fromDbDate, toDbDate } from '../modules/inventory/domain/index.js';
import { toDecimalInput } from '../shared/db/prisma-helpers.js';
import type { HistorySeedStore } from './history-seed.js';

export function createPrismaHistorySeedStore(prisma: PrismaClient): HistorySeedStore {
  return {
    countDelivered: () => prisma.order.count({ where: { status: 'DELIVERED' } }),

    async activeCustomerIds() {
      const rows = await prisma.customer.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
        orderBy: { name: 'asc' },
      });
      return rows.map((row) => row.id);
    },

    async unlinkedDispatches(since) {
      const rows = await prisma.inventoryMovement.findMany({
        where: { type: 'EXIT_DISPATCH', orderId: null, createdAt: { gte: since } },
        select: { id: true, quantity: true, createdAt: true, lot: { select: { productId: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((row) => ({
        id: row.id,
        productId: row.lot.productId,
        quantity: row.quantity.toNumber(),
        createdAt: row.createdAt,
      }));
    },

    async stockLots() {
      const rows = await prisma.inventoryLot.findMany({
        where: { quantity: { gt: 0 } },
        select: { id: true, quantity: true, expiryDate: true, product: { select: { unit: true } } },
      });
      return rows.map((row) => ({
        id: row.id,
        quantity: row.quantity.toNumber(),
        unit: row.product.unit,
        expiryDate: fromDbDate(row.expiryDate),
      }));
    },

    async apply({ orders, items, history, links, waste }) {
      const byOrder = new Map<string, string[]>();
      for (const { movementId, orderId } of links) {
        byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), movementId]);
      }
      // Orders go in by creation date, so their SERIAL numbers follow the history.
      const sorted = [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      await prisma.$transaction([
        prisma.order.createMany({
          data: sorted.map((order) => ({ ...order, dueDate: toDbDate(order.dueDate) })),
        }),
        prisma.orderItem.createMany({
          data: items.map(({ quantity, ...item }) => ({
            ...item,
            requestedQty: toDecimalInput(quantity),
            allocatedQty: toDecimalInput(quantity),
          })),
        }),
        prisma.orderStatusHistory.createMany({ data: history }),
        ...[...byOrder].map(([orderId, ids]) =>
          prisma.inventoryMovement.updateMany({
            where: { id: { in: ids }, orderId: null },
            data: { orderId },
          }),
        ),
        ...waste.flatMap((row) => [
          prisma.inventoryMovement.create({
            data: { ...row, type: 'EXIT_WASTE', quantity: toDecimalInput(row.quantity) },
          }),
          prisma.inventoryLot.update({
            where: { id: row.lotId },
            data: { quantity: { decrement: toDecimalInput(row.quantity) } },
          }),
        ]),
      ]);
    },
  };
}
