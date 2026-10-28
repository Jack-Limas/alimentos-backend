import { Prisma, type PrismaClient } from '@prisma/client';
import { auditLogData, toDecimalInput } from '../../shared/db/prisma-helpers.js';
import {
  InsufficientStockError,
  type InventoryRepository,
  type LotFilter,
  type MovementFilter,
  type MovementRecord,
} from './inventory.repository.js';

const LOT_ORDER: Prisma.InventoryLotOrderByWithRelationInput[] = [
  { expiryDate: 'asc' },
  { receivedAt: 'asc' },
  { id: 'asc' },
];

const WITH_PRODUCT = { lot: { select: { productId: true } } } as const;

type MovementWithLot = Prisma.InventoryMovementGetPayload<{ include: typeof WITH_PRODUCT }>;

const WITH_PRODUCT_NAME = {
  lot: { select: { productId: true, product: { select: { name: true, unit: true } } } },
} as const;

function toMovementRecord({ lot, ...movement }: MovementWithLot): MovementRecord {
  return { ...movement, productId: lot.productId };
}

function lotWhere(filter: LotFilter): Prisma.InventoryLotWhereInput {
  return {
    quantity: { gt: 0 },
    ...(filter.productId ? { productId: filter.productId } : {}),
    ...(filter.expiryFrom || filter.expiryTo
      ? {
          expiryDate: {
            ...(filter.expiryFrom ? { gte: filter.expiryFrom } : {}),
            ...(filter.expiryTo ? { lte: filter.expiryTo } : {}),
          },
        }
      : {}),
  };
}

function movementWhere(filter: MovementFilter): Prisma.InventoryMovementWhereInput {
  return {
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.productId ? { lot: { productId: filter.productId } } : {}),
    ...(filter.from || filter.to
      ? {
          createdAt: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          },
        }
      : {}),
  };
}

export function createPrismaInventoryRepository(prisma: PrismaClient): InventoryRepository {
  return {
    async stockByExpiry(productIds) {
      if (productIds?.length === 0) return [];
      // One grouped query for every product: remaining stock per expiry date.
      const rows = await prisma.inventoryLot.groupBy({
        by: ['productId', 'expiryDate'],
        where: {
          quantity: { gt: 0 },
          ...(productIds ? { productId: { in: [...productIds] } } : {}),
        },
        _sum: { quantity: true },
      });
      return rows.map((row) => ({
        productId: row.productId,
        expiryDate: row.expiryDate,
        quantity: row._sum.quantity ?? new Prisma.Decimal(0),
      }));
    },

    async dispatchedSince(since, productIds) {
      if (productIds?.length === 0) return [];
      // Prisma's groupBy cannot group movements by a column of their lot, so
      // this one aggregate is written in SQL (parameterized, no interpolation).
      return prisma.$queryRaw<{ productId: string; quantity: Prisma.Decimal }[]>`
        SELECT l."productId" AS "productId", SUM(m."quantity") AS "quantity"
        FROM "inventory_movements" m
        JOIN "inventory_lots" l ON l."id" = m."lotId"
        WHERE m."type" = 'EXIT_DISPATCH'
          AND m."createdAt" >= ${since}
          ${productIds ? Prisma.sql`AND l."productId" = ANY(${[...productIds]}::uuid[])` : Prisma.empty}
        GROUP BY l."productId"
      `;
    },

    findLot: (id) => prisma.inventoryLot.findUnique({ where: { id } }),

    lotsWithStock: (productId) =>
      prisma.inventoryLot.findMany({
        where: { productId, quantity: { gt: 0 } },
        orderBy: LOT_ORDER,
      }),

    async listLots(filter, page) {
      const where = lotWhere(filter);
      const [items, total] = await prisma.$transaction([
        prisma.inventoryLot.findMany({
          where,
          orderBy: LOT_ORDER,
          skip: page.skip,
          take: page.take,
        }),
        prisma.inventoryLot.count({ where }),
      ]);
      return { items, total };
    },

    async listMovements(filter, page) {
      const where = movementWhere(filter);
      const [items, total] = await prisma.$transaction([
        prisma.inventoryMovement.findMany({
          where,
          // The product name and unit come in the same query (no N+1).
          include: WITH_PRODUCT_NAME,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: page.skip,
          take: page.take,
        }),
        prisma.inventoryMovement.count({ where }),
      ]);
      return {
        items: items.map(({ lot, ...movement }) => ({
          ...movement,
          productId: lot.productId,
          productName: lot.product.name,
          unit: lot.product.unit,
        })),
        total,
      };
    },

    async createEntry({ lot, movement, audit }) {
      const quantity = toDecimalInput(lot.quantity);
      const [createdLot, createdMovement] = await prisma.$transaction([
        prisma.inventoryLot.create({
          data: { ...lot, quantity, initialQuantity: quantity },
        }),
        prisma.inventoryMovement.create({
          data: { ...movement, lotId: lot.id, type: 'ENTRY', quantity },
          include: WITH_PRODUCT,
        }),
        prisma.auditLog.create({ data: auditLogData(audit) }),
      ]);
      return { lot: createdLot, movement: toMovementRecord(createdMovement) };
    },

    applyExits({ type, reason, userId, allocations, audit }) {
      return prisma.$transaction(
        async (tx) => {
          // Optimistic concurrency without explicit locks: the decrement only
          // matches while the lot still has the quantity. If a concurrent exit
          // got there first, PostgreSQL re-checks the WHERE after it commits,
          // the count is 0, and throwing rolls back every change made here.
          for (const { lotId, qty } of allocations) {
            const { count } = await tx.inventoryLot.updateMany({
              where: { id: lotId, quantity: { gte: toDecimalInput(qty) } },
              data: { quantity: { decrement: toDecimalInput(qty) } },
            });
            if (count !== 1) throw new InsufficientStockError(lotId);
          }

          const movements: MovementRecord[] = [];
          for (const { movementId, lotId, qty } of allocations) {
            const created = await tx.inventoryMovement.create({
              data: { id: movementId, lotId, type, quantity: toDecimalInput(qty), reason, userId },
              include: WITH_PRODUCT,
            });
            movements.push(toMovementRecord(created));
          }
          await tx.auditLog.create({ data: auditLogData(audit) });
          return movements;
        },
        // Neon adds network latency per statement; the default 5 s is tight for several lots.
        { maxWait: 5_000, timeout: 15_000 },
      );
    },
  };
}
