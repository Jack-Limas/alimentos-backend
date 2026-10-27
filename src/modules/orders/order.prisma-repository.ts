import { Prisma, type PrismaClient } from '@prisma/client';
import { auditLogData, toDecimalInput } from '../../shared/db/prisma-helpers.js';
import {
  OrderStatusConflictError,
  type OrderFilter,
  type OrderRepository,
} from './order.repository.js';

const OPEN_STATUSES = ['PENDING', 'IN_PREPARATION', 'READY_FOR_DISPATCH'] as const;

const SUMMARY = {
  customer: { select: { id: true, name: true, type: true } },
  _count: { select: { items: true } },
} as const;

const DETAIL = {
  ...SUMMARY,
  items: {
    select: {
      id: true,
      productId: true,
      requestedQty: true,
      allocatedQty: true,
      product: { select: { name: true, unit: true } },
    },
    orderBy: { product: { name: 'asc' } },
  },
  history: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      userId: true,
      note: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.OrderInclude;

type SummaryRow = Prisma.OrderGetPayload<{ include: typeof SUMMARY }>;

function toSummary({ _count, ...order }: SummaryRow) {
  return { ...order, itemCount: _count.items };
}

function toWhere(filter: OrderFilter): Prisma.OrderWhereInput {
  return {
    ...(filter.statuses ? { status: { in: filter.statuses } } : {}),
    ...(filter.priority ? { priority: filter.priority } : {}),
    ...(filter.customerId ? { customerId: filter.customerId } : {}),
    ...(filter.dueBefore ? { dueDate: { lt: filter.dueBefore } } : {}),
  };
}

export function createPrismaOrderRepository(prisma: PrismaClient): OrderRepository {
  return {
    findById: (id) => prisma.order.findUnique({ where: { id } }),

    async findDetail(id) {
      const row = await prisma.order.findUnique({ where: { id }, include: DETAIL });
      if (!row) return null;
      const { _count, ...order } = row;
      return { ...order, itemCount: _count.items };
    },

    async list(filter, page) {
      const where = toWhere(filter);
      const [items, total] = await prisma.$transaction([
        prisma.order.findMany({
          where,
          include: SUMMARY,
          orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { number: 'asc' }],
          skip: page.skip,
          take: page.take,
        }),
        prisma.order.count({ where }),
      ]);
      return { items: items.map(toSummary), total };
    },

    productStatuses: (ids) =>
      prisma.product.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, status: true },
      }),

    async create({ items, historyId, audit, ...order }) {
      const [created] = await prisma.$transaction([
        prisma.order.create({
          data: {
            ...order,
            status: 'PENDING',
            items: {
              createMany: {
                data: items.map((item) => ({
                  id: item.id,
                  productId: item.productId,
                  requestedQty: toDecimalInput(item.requestedQty),
                })),
              },
            },
            history: {
              create: {
                id: historyId,
                fromStatus: null,
                toStatus: 'PENDING',
                userId: order.createdById,
              },
            },
          },
        }),
        prisma.auditLog.create({ data: auditLogData(audit) }),
      ]);
      return created;
    },

    movementsOf: (orderId) =>
      prisma.inventoryMovement.findMany({
        where: { orderId },
        select: { lotId: true, type: true, quantity: true },
      }),

    changeStatus(change) {
      const { orderId, from, to, returns } = change;
      return prisma.$transaction(
        async (tx) => {
          // Optimistic concurrency: the update only matches while the order is
          // still in the status the service validated. If another request moved
          // it first, the count is 0 and throwing rolls back everything below.
          const { count } = await tx.order.updateMany({
            where: { id: orderId, status: from },
            data: { status: to },
          });
          if (count !== 1) throw new OrderStatusConflictError(orderId);

          for (const { lotId, qty } of returns) {
            await tx.inventoryLot.update({
              where: { id: lotId },
              data: { quantity: { increment: toDecimalInput(qty) } },
            });
          }
          if (returns.length > 0) {
            await tx.inventoryMovement.createMany({
              data: returns.map(({ movementId, lotId, qty }) => ({
                id: movementId,
                lotId,
                type: 'RETURN' as const,
                quantity: toDecimalInput(qty),
                reason: change.note,
                orderId,
                userId: change.userId,
              })),
            });
          }
          if (change.resetAllocations) {
            await tx.orderItem.updateMany({
              where: { orderId },
              data: { allocatedQty: toDecimalInput(0) },
            });
          }
          await tx.orderStatusHistory.create({
            data: {
              id: change.historyId,
              orderId,
              fromStatus: from,
              toStatus: to,
              userId: change.userId,
              note: change.note,
            },
          });
          await tx.auditLog.create({ data: auditLogData(change.audit) });
          return tx.order.findUniqueOrThrow({ where: { id: orderId } });
        },
        // Neon adds network latency per statement; the default 5 s is tight for several lots.
        { maxWait: 5_000, timeout: 15_000 },
      );
    },

    async pendingDemand() {
      // One grouped query instead of one per product.
      const rows = await prisma.orderItem.groupBy({
        by: ['productId'],
        where: { order: { status: 'PENDING' } },
        _sum: { requestedQty: true },
      });
      return rows.map((row) => ({
        productId: row.productId,
        quantity: row._sum.requestedQty ?? new Prisma.Decimal(0),
      }));
    },

    openOrdersDueBy: (date) =>
      prisma.order.findMany({
        where: { status: { in: [...OPEN_STATUSES] }, dueDate: { lte: date } },
        orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
      }),
  };
}
