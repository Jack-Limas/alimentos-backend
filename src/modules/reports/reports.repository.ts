import type { CustomerType, OrderPriority, OrderStatus, PrismaClient, Unit } from '@prisma/client';

/** One order of the orders report (created in the range). */
export interface OrderReportRow {
  number: number;
  customerName: string;
  customerType: CustomerType;
  priority: OrderPriority;
  status: OrderStatus;
  /** @db.Date, midnight UTC. */
  dueDate: Date;
  createdAt: Date;
  itemCount: number;
}

/** An EXIT_WASTE movement with its product and lot. */
export interface WasteMovementRow {
  createdAt: Date;
  productName: string;
  unit: Unit;
  lotCode: string | null;
  /** @db.Date, midnight UTC. */
  expiryDate: Date;
  quantity: number;
  reason: string | null;
}

/** An EXIT_DISPATCH movement for /public/impact (no customer, no user). */
export interface DispatchRow {
  createdAt: Date;
  unit: Unit;
  quantity: number;
  /** Expiry of the lot it came from, @db.Date midnight UTC. */
  expiryDate: Date;
}

/** A delivery for /public/impact: when, the due date and the customer type only. */
export interface DeliveryRow {
  orderId: string;
  customerId: string;
  customerType: CustomerType;
  deliveredAt: Date;
  /** @db.Date, midnight UTC. */
  dueDate: Date;
}

/**
 * Read-only queries behind the reports and the public impact page. All of
 * them run on the main thread; only formatting goes to the worker pool.
 */
export interface ReportsRepository {
  /** Orders created in [from, to), oldest first. */
  ordersCreatedBetween(from: Date, to: Date): Promise<OrderReportRow[]>;
  /** EXIT_WASTE movements in [from, to), oldest first. */
  wasteBetween(from: Date, to: Date): Promise<WasteMovementRow[]>;
  dispatchesSince(since: Date): Promise<DispatchRow[]>;
  /** Orders that reached DELIVERED since `since` (the latest DELIVERED row of each). */
  deliveriesSince(since: Date): Promise<DeliveryRow[]>;
}

export function createPrismaReportsRepository(prisma: PrismaClient): ReportsRepository {
  return {
    async ordersCreatedBetween(from, to) {
      const rows = await prisma.order.findMany({
        where: { createdAt: { gte: from, lt: to } },
        select: {
          number: true,
          priority: true,
          status: true,
          dueDate: true,
          createdAt: true,
          customer: { select: { name: true, type: true } },
          _count: { select: { items: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { number: 'asc' }],
      });
      return rows.map(({ customer, _count, ...order }) => ({
        ...order,
        customerName: customer.name,
        customerType: customer.type,
        itemCount: _count.items,
      }));
    },

    async wasteBetween(from, to) {
      const rows = await prisma.inventoryMovement.findMany({
        where: { type: 'EXIT_WASTE', createdAt: { gte: from, lt: to } },
        select: {
          createdAt: true,
          quantity: true,
          reason: true,
          lot: {
            select: {
              lotCode: true,
              expiryDate: true,
              product: { select: { name: true, unit: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map(({ lot, quantity, ...movement }) => ({
        ...movement,
        quantity: quantity.toNumber(),
        productName: lot.product.name,
        unit: lot.product.unit,
        lotCode: lot.lotCode,
        expiryDate: lot.expiryDate,
      }));
    },

    async dispatchesSince(since) {
      const rows = await prisma.inventoryMovement.findMany({
        where: { type: 'EXIT_DISPATCH', createdAt: { gte: since } },
        select: {
          createdAt: true,
          quantity: true,
          lot: { select: { expiryDate: true, product: { select: { unit: true } } } },
        },
      });
      return rows.map((row) => ({
        createdAt: row.createdAt,
        quantity: row.quantity.toNumber(),
        unit: row.lot.product.unit,
        expiryDate: row.lot.expiryDate,
      }));
    },

    async deliveriesSince(since) {
      const rows = await prisma.orderStatusHistory.findMany({
        where: { toStatus: 'DELIVERED', createdAt: { gte: since } },
        select: {
          orderId: true,
          createdAt: true,
          order: {
            select: { dueDate: true, customerId: true, customer: { select: { type: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      // One delivery per order (the latest DELIVERED row).
      const byOrder = new Map<string, DeliveryRow>();
      for (const row of rows) {
        byOrder.set(row.orderId, {
          orderId: row.orderId,
          customerId: row.order.customerId,
          customerType: row.order.customer.type,
          deliveredAt: row.createdAt,
          dueDate: row.order.dueDate,
        });
      }
      return [...byOrder.values()];
    },
  };
}
