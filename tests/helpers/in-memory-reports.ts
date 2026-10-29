import type { OrderStatus } from '@prisma/client';
import type { CustomerRecord } from '../../src/modules/customers/customer.repository.js';
import type {
  LotRecord,
  MovementRecord,
} from '../../src/modules/inventory/inventory.repository.js';
import type { OrderRecord } from '../../src/modules/orders/order.repository.js';
import type { ProductRecord } from '../../src/modules/products/product.repository.js';
import type { ReportsRepository } from '../../src/modules/reports/reports.repository.js';

/** The in-memory data the reports read (shared with the other repositories). */
interface Base {
  products: { products: Map<string, ProductRecord> };
  inventory: { lots: Map<string, LotRecord>; movements: MovementRecord[] };
  customers: { customers: Map<string, CustomerRecord> };
  orders: {
    orders: Map<string, OrderRecord>;
    items: { orderId: string }[];
    history: { orderId: string; toStatus: OrderStatus; createdAt: Date }[];
  };
}

/** Same queries as the Prisma repository, over the shared in-memory data. */
export function createInMemoryReportsRepository(repos: Base): ReportsRepository {
  const lotOf = (lotId: string) => repos.inventory.lots.get(lotId);
  const productOf = (productId: string) => repos.products.products.get(productId);
  const inRange = (date: Date, from: Date, to?: Date) =>
    date.getTime() >= from.getTime() && (to === undefined || date.getTime() < to.getTime());

  return {
    ordersCreatedBetween(from, to) {
      return Promise.resolve(
        [...repos.orders.orders.values()]
          .filter((order) => inRange(order.createdAt, from, to))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.number - b.number)
          .map((order) => {
            const customer = repos.customers.customers.get(order.customerId);
            return {
              number: order.number,
              customerName: customer?.name ?? '',
              customerType: customer?.type ?? 'SUPERMARKET',
              priority: order.priority,
              status: order.status,
              dueDate: order.dueDate,
              createdAt: order.createdAt,
              itemCount: repos.orders.items.filter((item) => item.orderId === order.id).length,
            };
          }),
      );
    },

    wasteBetween(from, to) {
      return Promise.resolve(
        repos.inventory.movements
          .filter((m) => m.type === 'EXIT_WASTE' && inRange(m.createdAt, from, to))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((m) => {
            const lot = lotOf(m.lotId);
            const product = productOf(m.productId);
            return {
              createdAt: m.createdAt,
              productName: product?.name ?? '',
              unit: product?.unit ?? 'KG',
              lotCode: lot?.lotCode ?? null,
              expiryDate: lot?.expiryDate ?? new Date(0),
              quantity: m.quantity.toNumber(),
              reason: m.reason,
            };
          }),
      );
    },

    dispatchesSince(since) {
      return Promise.resolve(
        repos.inventory.movements
          .filter((m) => m.type === 'EXIT_DISPATCH' && inRange(m.createdAt, since))
          .map((m) => ({
            createdAt: m.createdAt,
            quantity: m.quantity.toNumber(),
            unit: productOf(m.productId)?.unit ?? 'KG',
            expiryDate: lotOf(m.lotId)?.expiryDate ?? new Date(0),
          })),
      );
    },

    deliveriesSince(since) {
      const latest = new Map<string, Date>();
      for (const row of repos.orders.history) {
        if (row.toStatus === 'DELIVERED' && inRange(row.createdAt, since)) {
          latest.set(row.orderId, row.createdAt);
        }
      }
      return Promise.resolve(
        [...latest].flatMap(([orderId, deliveredAt]) => {
          const order = repos.orders.orders.get(orderId);
          if (!order) return [];
          return {
            orderId,
            customerId: order.customerId,
            customerType: repos.customers.customers.get(order.customerId)?.type ?? 'SUPERMARKET',
            deliveredAt,
            dueDate: order.dueDate,
          };
        }),
      );
    },
  };
}
