import type { PrismaClient } from '@prisma/client';
import { toDbDate } from '../modules/inventory/domain/index.js';
import { toDecimalInput } from '../shared/db/prisma-helpers.js';
import type { OrdersSeedStore } from './seed-orders.js';

export function createPrismaOrdersSeedStore(prisma: PrismaClient): OrdersSeedStore {
  return {
    countCustomers: () => prisma.customer.count(),

    async insertCustomers(customers) {
      await prisma.customer.createMany({ data: customers });
    },

    async activeCustomerIds() {
      const rows = await prisma.customer.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
        orderBy: { name: 'asc' },
      });
      return rows.map((row) => row.id);
    },

    countOrders: () => prisma.order.count(),

    products: () => prisma.product.findMany({ select: { id: true, name: true, status: true } }),

    async insertOrders({ orders, items, history }) {
      // Orders are inserted in creation order, so the SERIAL numbers follow it.
      await prisma.$transaction([
        prisma.order.createMany({
          data: orders.map((order) => ({
            ...order,
            dueDate: toDbDate(order.dueDate),
            updatedAt: order.createdAt,
          })),
        }),
        prisma.orderItem.createMany({
          data: items.map((item) => ({ ...item, requestedQty: toDecimalInput(item.requestedQty) })),
        }),
        prisma.orderStatusHistory.createMany({ data: history }),
      ]);
    },
  };
}
