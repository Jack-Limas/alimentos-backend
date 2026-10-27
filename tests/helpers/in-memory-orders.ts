import type { Prisma } from '@prisma/client';
import type { AuditLogRepository } from '../../src/modules/audit/audit-log.repository.js';
import type {
  CustomerRecord,
  CustomerRepository,
} from '../../src/modules/customers/customer.repository.js';
import type {
  LotRecord,
  MovementRecord,
} from '../../src/modules/inventory/inventory.repository.js';
import {
  OrderStatusConflictError,
  type OrderRecord,
  type OrderRepository,
  type OrderSummaryRecord,
} from '../../src/modules/orders/order.repository.js';
import type { ProductRecord } from '../../src/modules/products/product.repository.js';
import { dec } from './in-memory-inventory.js';

const OPEN = new Set(['PENDING', 'IN_PREPARATION', 'READY_FOR_DISPATCH']);
const PRIORITY_RANK = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

export function createInMemoryCustomerRepository(audit: AuditLogRepository) {
  const customers = new Map<string, CustomerRecord>();
  const repository: CustomerRepository & { customers: Map<string, CustomerRecord> } = {
    customers,
    findById: (id) => Promise.resolve(customers.get(id) ?? null),
    list(filter, page) {
      const matched = [...customers.values()]
        .filter((c) => !filter.search || c.name.toLowerCase().includes(filter.search.toLowerCase()))
        .filter((c) => !filter.type || c.type === filter.type)
        .filter((c) => !filter.status || c.status === filter.status)
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      return Promise.resolve({
        items: matched.slice(page.skip, page.skip + page.take),
        total: matched.length,
      });
    },
    async create(customer, entry) {
      const now = new Date();
      const record: CustomerRecord = {
        ...customer,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      };
      customers.set(record.id, record);
      await audit.create(entry);
      return record;
    },
    async update(id, patch, entry) {
      const current = customers.get(id);
      if (!current) throw new Error('not found');
      const changes = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as Partial<CustomerRecord>;
      const updated: CustomerRecord = { ...current, ...changes, updatedAt: new Date() };
      customers.set(id, updated);
      await audit.create(entry);
      return updated;
    },
  };
  return repository;
}

interface ItemRow {
  id: string;
  orderId: string;
  productId: string;
  requestedQty: Prisma.Decimal;
  allocatedQty: Prisma.Decimal;
}

interface HistoryRow {
  id: string;
  orderId: string;
  fromStatus: OrderRecord['status'] | null;
  toStatus: OrderRecord['status'];
  userId: string;
  note: string | null;
  createdAt: Date;
}

export interface InMemoryOrderDeps {
  products: Map<string, ProductRecord>;
  customers: Map<string, CustomerRecord>;
  lots: Map<string, LotRecord>;
  movements: MovementRecord[];
}

export function createInMemoryOrderRepository(audit: AuditLogRepository, deps: InMemoryOrderDeps) {
  const orders = new Map<string, OrderRecord>();
  const items: ItemRow[] = [];
  const history: HistoryRow[] = [];
  let nextNumber = 1;

  const summary = (order: OrderRecord): OrderSummaryRecord => {
    const customer = deps.customers.get(order.customerId);
    return {
      ...order,
      customer: {
        id: order.customerId,
        name: customer?.name ?? '',
        type: customer?.type ?? 'SUPERMARKET',
      },
      itemCount: items.filter((item) => item.orderId === order.id).length,
    };
  };

  const repository: OrderRepository & {
    orders: Map<string, OrderRecord>;
    items: ItemRow[];
    history: HistoryRow[];
    /** Stores an order directly in any status (with its items), as a seed would. */
    addOrder(
      order: Partial<OrderRecord> & { customerId: string; createdById: string },
      lines?: { productId: string; requestedQty: number; allocatedQty?: number }[],
    ): OrderRecord;
  } = {
    orders,
    items,
    history,

    addOrder(order, lines = []) {
      const now = new Date('2026-10-20T12:00:00Z');
      const record: OrderRecord = {
        id: crypto.randomUUID(),
        number: nextNumber++,
        status: 'PENDING',
        priority: 'MEDIUM',
        dueDate: new Date('2026-11-05T00:00:00.000Z'),
        notes: null,
        createdAt: now,
        updatedAt: now,
        ...order,
      };
      orders.set(record.id, record);
      for (const line of lines) {
        items.push({
          id: crypto.randomUUID(),
          orderId: record.id,
          productId: line.productId,
          requestedQty: dec(line.requestedQty),
          allocatedQty: dec(line.allocatedQty ?? 0),
        });
      }
      return record;
    },

    findById: (id) => Promise.resolve(orders.get(id) ?? null),

    findDetail(id) {
      const order = orders.get(id);
      if (!order) return Promise.resolve(null);
      return Promise.resolve({
        ...summary(order),
        items: items
          .filter((item) => item.orderId === id)
          .map((item) => {
            const product = deps.products.get(item.productId);
            return {
              id: item.id,
              productId: item.productId,
              product: { name: product?.name ?? '', unit: product?.unit ?? 'KG' },
              requestedQty: item.requestedQty,
              allocatedQty: item.allocatedQty,
            };
          })
          .sort((a, b) => (a.product.name < b.product.name ? -1 : 1)),
        history: history
          .filter((row) => row.orderId === id)
          .map(({ orderId: _orderId, ...row }) => row),
      });
    },

    list(filter, page) {
      const matched = [...orders.values()]
        .filter((o) => !filter.statuses || filter.statuses.includes(o.status))
        .filter((o) => !filter.priority || o.priority === filter.priority)
        .filter((o) => !filter.customerId || o.customerId === filter.customerId)
        .filter((o) => !filter.dueBefore || o.dueDate < filter.dueBefore)
        .sort(
          (a, b) =>
            a.dueDate.getTime() - b.dueDate.getTime() ||
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
            a.number - b.number,
        );
      return Promise.resolve({
        items: matched.slice(page.skip, page.skip + page.take).map(summary),
        total: matched.length,
      });
    },

    productStatuses: (ids) =>
      Promise.resolve(
        ids.flatMap((id) => {
          const product = deps.products.get(id);
          return product ? [{ id, status: product.status }] : [];
        }),
      ),

    async create({ items: lines, historyId, audit: entry, ...order }) {
      const now = new Date();
      const record: OrderRecord = {
        ...order,
        number: nextNumber++,
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
      };
      orders.set(record.id, record);
      for (const line of lines) {
        items.push({
          id: line.id,
          orderId: record.id,
          productId: line.productId,
          requestedQty: dec(line.requestedQty),
          allocatedQty: dec(0),
        });
      }
      history.push({
        id: historyId,
        orderId: record.id,
        fromStatus: null,
        toStatus: 'PENDING',
        userId: order.createdById,
        note: null,
        createdAt: now,
      });
      await audit.create(entry);
      return record;
    },

    movementsOf: (orderId) =>
      Promise.resolve(
        deps.movements
          .filter((m) => m.orderId === orderId)
          .map((m) => ({ lotId: m.lotId, type: m.type, quantity: m.quantity })),
      ),

    async changeStatus(change) {
      // Same all-or-nothing contract as the transaction: check everything first.
      const current = orders.get(change.orderId);
      if (current?.status !== change.from) throw new OrderStatusConflictError(change.orderId);
      for (const { lotId } of change.returns) {
        if (!deps.lots.has(lotId)) throw new Error(`lot ${lotId} not found`);
      }

      const now = new Date();
      for (const { movementId, lotId, qty } of change.returns) {
        const lot = deps.lots.get(lotId);
        if (!lot) continue;
        deps.lots.set(lotId, { ...lot, quantity: lot.quantity.plus(dec(qty)) });
        deps.movements.push({
          id: movementId,
          lotId,
          productId: lot.productId,
          type: 'RETURN',
          quantity: dec(qty),
          reason: change.note,
          orderId: change.orderId,
          userId: change.userId,
          createdAt: now,
        });
      }
      if (change.resetAllocations) {
        for (const item of items) if (item.orderId === change.orderId) item.allocatedQty = dec(0);
      }
      const updated: OrderRecord = { ...current, status: change.to, updatedAt: now };
      orders.set(change.orderId, updated);
      history.push({
        id: change.historyId,
        orderId: change.orderId,
        fromStatus: change.from,
        toStatus: change.to,
        userId: change.userId,
        note: change.note,
        createdAt: now,
      });
      await audit.create(change.audit);
      return updated;
    },

    pendingDemand() {
      const totals = new Map<string, Prisma.Decimal>();
      for (const item of items) {
        if (orders.get(item.orderId)?.status !== 'PENDING') continue;
        totals.set(item.productId, (totals.get(item.productId) ?? dec(0)).plus(item.requestedQty));
      }
      return Promise.resolve([...totals].map(([productId, quantity]) => ({ productId, quantity })));
    },

    openOrdersDueBy: (date) =>
      Promise.resolve(
        [...orders.values()]
          .filter((o) => OPEN.has(o.status) && o.dueDate <= date)
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.number - b.number),
      ),
  };
  return repository;
}
