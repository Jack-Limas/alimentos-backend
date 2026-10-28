import type { AuditLogRepository } from '../../src/modules/audit/audit-log.repository.js';
import type { CustomerRecord } from '../../src/modules/customers/customer.repository.js';
import {
  StaleProposalError,
  type DistributionRepository,
  type ProposalDetailRecord,
  type ProposalRecord,
} from '../../src/modules/distribution/distribution.repository.js';
import { fromDbDate } from '../../src/modules/inventory/domain/index.js';
import type {
  LotRecord,
  MovementRecord,
} from '../../src/modules/inventory/inventory.repository.js';
import type { ProductRecord } from '../../src/modules/products/product.repository.js';
import { dec } from './in-memory-inventory.js';
import type { createInMemoryOrderRepository } from './in-memory-orders.js';

export interface InMemoryDistributionDeps {
  products: Map<string, ProductRecord>;
  customers: Map<string, CustomerRecord>;
  lots: Map<string, LotRecord>;
  movements: MovementRecord[];
  orders: ReturnType<typeof createInMemoryOrderRepository>;
}

/** Same contract as the Prisma repository, including the all-or-nothing confirmation. */
export function createInMemoryDistributionRepository(
  audit: AuditLogRepository,
  deps: InMemoryDistributionDeps,
) {
  const proposals = new Map<string, ProposalDetailRecord>();
  const strip = ({ lines: _lines, ...record }: ProposalDetailRecord): ProposalRecord => record;

  const repository: DistributionRepository & {
    proposals: Map<string, ProposalDetailRecord>;
    /** Runs right before confirm() applies anything, to simulate a concurrent change. */
    beforeConfirm?: () => void;
  } = {
    proposals,

    loadSnapshot(minExpiry) {
      const pending = [...deps.orders.orders.values()]
        .filter((order) => order.status === 'PENDING')
        .sort((a, b) => a.number - b.number);
      const lots = [...deps.lots.values()]
        .filter((lot) => lot.quantity.gt(0) && lot.expiryDate >= minExpiry)
        .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime() || (a.id < b.id ? -1 : 1));
      const orders = pending.map((order) => ({
        id: order.id,
        number: order.number,
        priority: order.priority,
        dueDate: fromDbDate(order.dueDate),
        createdAt: order.createdAt.toISOString(),
        customerName: deps.customers.get(order.customerId)?.name ?? '',
        customerType: deps.customers.get(order.customerId)?.type ?? 'SUPERMARKET',
        items: deps.orders.items
          .filter((item) => item.orderId === order.id)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((item) => ({
            id: item.id,
            productId: item.productId,
            requestedQty: item.requestedQty.toNumber(),
          })),
      }));
      const ids = new Set([
        ...orders.flatMap((o) => o.items.map((i) => i.productId)),
        ...lots.map((l) => l.productId),
      ]);
      return Promise.resolve({
        orders,
        lots: lots.map((lot) => ({
          id: lot.id,
          productId: lot.productId,
          quantity: lot.quantity.toNumber(),
          expiryDate: fromDbDate(lot.expiryDate),
          receivedAt: lot.receivedAt.toISOString(),
        })),
        products: [...ids].sort().flatMap((id) => {
          const product = deps.products.get(id);
          return product ? [{ id, name: product.name, unit: product.unit }] : [];
        }),
      });
    },

    async createProposal({ lines, audit: entry, ...proposal }) {
      const record: ProposalDetailRecord = {
        ...proposal,
        status: 'DRAFT',
        confirmedById: null,
        confirmedAt: null,
        createdAt: new Date(),
        lines: lines.map((line) => {
          const order = deps.orders.orders.get(line.orderId);
          const product = deps.products.get(line.productId);
          const lot = line.lotId ? deps.lots.get(line.lotId) : undefined;
          return {
            ...line,
            score: dec(line.score),
            requestedQty: dec(line.requestedQty),
            availableQty: dec(line.availableQty),
            recommendedQty: dec(line.recommendedQty),
            order: {
              number: order?.number ?? 0,
              priority: order?.priority ?? 'MEDIUM',
              status: order?.status ?? 'PENDING',
              dueDate: order?.dueDate ?? new Date(0),
              customerName: deps.customers.get(order?.customerId ?? '')?.name ?? '',
              customerType: deps.customers.get(order?.customerId ?? '')?.type ?? 'SUPERMARKET',
            },
            product: { name: product?.name ?? '', unit: product?.unit ?? 'KG' },
            lot: lot ? { lotCode: lot.lotCode, expiryDate: lot.expiryDate } : null,
          };
        }),
      };
      proposals.set(record.id, record);
      await audit.create(entry);
      return strip(record);
    },

    listProposals(filter, page) {
      const matched = [...proposals.values()]
        .filter((p) => !filter.status || p.status === filter.status)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return Promise.resolve({
        items: matched.slice(page.skip, page.skip + page.take).map(strip),
        total: matched.length,
      });
    },

    findProposal(id) {
      const proposal = proposals.get(id);
      if (!proposal) return Promise.resolve(null);
      // Line order fields reflect the current order status, like the SQL join.
      return Promise.resolve({
        ...proposal,
        lines: proposal.lines.map((line) => ({
          ...line,
          order: {
            ...line.order,
            status: deps.orders.orders.get(line.orderId)?.status ?? line.order.status,
          },
        })),
      });
    },

    async confirm({ proposalId, userId, confirmedAt, allocations, orders, note, audit: entry }) {
      repository.beforeConfirm?.();
      // Validate every condition first, then apply: nothing partial on failure.
      const proposal = proposals.get(proposalId);
      if (proposal?.status !== 'DRAFT') throw new StaleProposalError('NOT_DRAFT');
      const remaining = new Map<string, ReturnType<typeof dec>>();
      for (const { lotId, productId, qty } of allocations) {
        const current = remaining.get(lotId) ?? deps.lots.get(lotId)?.quantity;
        if (!current || current.lt(dec(qty))) {
          throw new StaleProposalError('STOCK_CHANGED', { lotId, productId });
        }
        remaining.set(lotId, current.minus(dec(qty)));
      }
      for (const { orderId } of orders) {
        if (deps.orders.orders.get(orderId)?.status !== 'PENDING') {
          throw new StaleProposalError('ORDER_CHANGED', { orderId });
        }
      }

      proposals.set(proposalId, {
        ...proposal,
        status: 'CONFIRMED',
        confirmedById: userId,
        confirmedAt,
      });
      for (const [lotId, quantity] of remaining) {
        const lot = deps.lots.get(lotId);
        if (lot) deps.lots.set(lotId, { ...lot, quantity });
      }
      for (const allocation of allocations) {
        deps.movements.push({
          id: allocation.movementId,
          lotId: allocation.lotId,
          productId: allocation.productId,
          type: 'EXIT_DISPATCH',
          quantity: dec(allocation.qty),
          reason: note,
          orderId: allocation.orderId,
          userId,
          createdAt: confirmedAt,
        });
        const item = deps.orders.items.find((i) => i.id === allocation.orderItemId);
        if (item) item.allocatedQty = item.allocatedQty.plus(dec(allocation.qty));
      }
      for (const { orderId, historyId } of orders) {
        const order = deps.orders.orders.get(orderId);
        if (order) deps.orders.orders.set(orderId, { ...order, status: 'IN_PREPARATION' });
        deps.orders.history.push({
          id: historyId,
          orderId,
          fromStatus: 'PENDING',
          toStatus: 'IN_PREPARATION',
          userId,
          note,
          createdAt: confirmedAt,
        });
      }
      await audit.create(entry);
    },

    async discard(id, entry) {
      const proposal = proposals.get(id);
      if (proposal?.status !== 'DRAFT') return false;
      proposals.set(id, { ...proposal, status: 'DISCARDED' });
      await audit.create(entry);
      return true;
    },

    saveAiInsight(id, insight) {
      const proposal = proposals.get(id);
      if (!proposal) return Promise.resolve(false);
      proposals.set(id, { ...proposal, aiInsight: insight });
      return Promise.resolve(true);
    },
  };
  return repository;
}
