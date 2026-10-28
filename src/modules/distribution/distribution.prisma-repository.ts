import { Prisma, type PrismaClient } from '@prisma/client';
import { auditLogData, toDecimalInput } from '../../shared/db/prisma-helpers.js';
import { fromDbDate, fromMilli, toMilli } from '../inventory/domain/index.js';
import type { DistributionReason, Weights } from './domain/index.js';
import {
  StaleProposalError,
  type DistributionRepository,
  type ProposalAiInsight,
  type ProposalLineRecord,
  type ProposalRecord,
  type StoredSummary,
} from './distribution.repository.js';

type ProposalRow = Prisma.DistributionProposalGetPayload<object>;

function toRecord(row: ProposalRow): ProposalRecord {
  return {
    ...row,
    weights: row.weights as unknown as Weights,
    summary: row.summary as unknown as StoredSummary,
    aiInsight: row.aiInsight as unknown as ProposalAiInsight | null,
  };
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

const LINE_INCLUDE = {
  order: {
    select: {
      number: true,
      priority: true,
      status: true,
      dueDate: true,
      customer: { select: { name: true, type: true } },
    },
  },
  product: { select: { name: true, unit: true } },
  lot: { select: { lotCode: true, expiryDate: true } },
} satisfies Prisma.ProposalLineInclude;

type LineRow = Prisma.ProposalLineGetPayload<{ include: typeof LINE_INCLUDE }>;

function toLine({ order, reasons, proposalId: _proposalId, ...line }: LineRow): ProposalLineRecord {
  const { customer, ...orderFields } = order;
  return {
    ...line,
    reasons: reasons as unknown as DistributionReason[],
    order: { ...orderFields, customerName: customer.name, customerType: customer.type },
  };
}

export function createPrismaDistributionRepository(prisma: PrismaClient): DistributionRepository {
  return {
    async loadSnapshot(minExpiry) {
      const [orders, lots] = await Promise.all([
        prisma.order.findMany({
          where: { status: 'PENDING' },
          select: {
            id: true,
            number: true,
            priority: true,
            dueDate: true,
            createdAt: true,
            customer: { select: { name: true, type: true } },
            items: {
              select: { id: true, productId: true, requestedQty: true },
              orderBy: { id: 'asc' },
            },
          },
          orderBy: { number: 'asc' },
        }),
        prisma.inventoryLot.findMany({
          where: { quantity: { gt: 0 }, expiryDate: { gte: minExpiry } },
          select: { id: true, productId: true, quantity: true, expiryDate: true, receivedAt: true },
          orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }, { id: 'asc' }],
        }),
      ]);
      const productIds = new Set([
        ...orders.flatMap((order) => order.items.map((item) => item.productId)),
        ...lots.map((lot) => lot.productId),
      ]);
      const products = await prisma.product.findMany({
        where: { id: { in: [...productIds] } },
        select: { id: true, name: true, unit: true },
        orderBy: { id: 'asc' },
      });

      return {
        orders: orders.map(({ customer, items, ...order }) => ({
          id: order.id,
          number: order.number,
          priority: order.priority,
          dueDate: fromDbDate(order.dueDate),
          createdAt: order.createdAt.toISOString(),
          customerName: customer.name,
          customerType: customer.type,
          items: items.map((item) => ({
            id: item.id,
            productId: item.productId,
            requestedQty: item.requestedQty.toNumber(),
          })),
        })),
        lots: lots.map((lot) => ({
          id: lot.id,
          productId: lot.productId,
          quantity: lot.quantity.toNumber(),
          expiryDate: fromDbDate(lot.expiryDate),
          receivedAt: lot.receivedAt.toISOString(),
        })),
        products,
      };
    },

    async createProposal({ lines, audit, ...proposal }) {
      const [created] = await prisma.$transaction([
        prisma.distributionProposal.create({
          data: {
            ...proposal,
            weights: json(proposal.weights),
            summary: json(proposal.summary),
            aiInsight: proposal.aiInsight === null ? Prisma.DbNull : json(proposal.aiInsight),
          },
        }),
        prisma.proposalLine.createMany({
          data: lines.map((line) => ({
            ...line,
            proposalId: proposal.id,
            score: line.score.toFixed(2),
            requestedQty: toDecimalInput(line.requestedQty),
            availableQty: toDecimalInput(line.availableQty),
            recommendedQty: toDecimalInput(line.recommendedQty),
            reasons: json(line.reasons),
          })),
        }),
        prisma.auditLog.create({ data: auditLogData(audit) }),
      ]);
      return toRecord(created);
    },

    async listProposals(filter, page) {
      const where = filter.status ? { status: filter.status } : {};
      const [items, total] = await prisma.$transaction([
        prisma.distributionProposal.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: page.skip,
          take: page.take,
        }),
        prisma.distributionProposal.count({ where }),
      ]);
      return { items: items.map(toRecord), total };
    },

    async findProposal(id) {
      const row = await prisma.distributionProposal.findUnique({
        where: { id },
        include: {
          lines: { include: LINE_INCLUDE, orderBy: [{ rank: 'asc' }, { id: 'asc' }] },
        },
      });
      if (!row) return null;
      const { lines, ...proposal } = row;
      return { ...toRecord(proposal), lines: lines.map(toLine) };
    },

    confirm({ proposalId, userId, confirmedAt, allocations, orders, note, audit }) {
      return prisma.$transaction(
        async (tx) => {
          // 1. Only a DRAFT can be confirmed, and only once (two clicks, two tabs).
          const proposal = await tx.distributionProposal.updateMany({
            where: { id: proposalId, status: 'DRAFT' },
            data: { status: 'CONFIRMED', confirmedById: userId, confirmedAt },
          });
          if (proposal.count !== 1) throw new StaleProposalError('NOT_DRAFT');

          // 2. Each lot is decremented only while it still has the quantity. If an
          //    exit or another confirmation took it, throwing rolls everything back.
          for (const { lotId, productId, qty } of allocations) {
            const { count } = await tx.inventoryLot.updateMany({
              where: { id: lotId, quantity: { gte: toDecimalInput(qty) } },
              data: { quantity: { decrement: toDecimalInput(qty) } },
            });
            if (count !== 1) throw new StaleProposalError('STOCK_CHANGED', { lotId, productId });
          }

          // 3. Orders move only if they are still PENDING (not cancelled meanwhile).
          for (const { orderId } of orders) {
            const { count } = await tx.order.updateMany({
              where: { id: orderId, status: 'PENDING' },
              data: { status: 'IN_PREPARATION' },
            });
            if (count !== 1) throw new StaleProposalError('ORDER_CHANGED', { orderId });
          }

          await tx.inventoryMovement.createMany({
            data: allocations.map((allocation) => ({
              id: allocation.movementId,
              lotId: allocation.lotId,
              type: 'EXIT_DISPATCH' as const,
              quantity: toDecimalInput(allocation.qty),
              reason: note,
              orderId: allocation.orderId,
              userId,
            })),
          });

          const perItem = new Map<string, number>();
          for (const { orderItemId, qty } of allocations) {
            perItem.set(orderItemId, (perItem.get(orderItemId) ?? 0) + toMilli(qty));
          }
          for (const [orderItemId, milli] of perItem) {
            await tx.orderItem.update({
              where: { id: orderItemId },
              data: { allocatedQty: { increment: toDecimalInput(fromMilli(milli)) } },
            });
          }

          await tx.orderStatusHistory.createMany({
            data: orders.map(({ orderId, historyId }) => ({
              id: historyId,
              orderId,
              fromStatus: 'PENDING' as const,
              toStatus: 'IN_PREPARATION' as const,
              userId,
              note,
              createdAt: confirmedAt,
            })),
          });
          await tx.auditLog.create({ data: auditLogData(audit) });
        },
        // Many statements over Neon's network: give the transaction room.
        { maxWait: 5_000, timeout: 30_000 },
      );
    },

    async discard(id, audit) {
      return prisma.$transaction(async (tx) => {
        const { count } = await tx.distributionProposal.updateMany({
          where: { id, status: 'DRAFT' },
          data: { status: 'DISCARDED' },
        });
        if (count !== 1) return false;
        await tx.auditLog.create({ data: auditLogData(audit) });
        return true;
      });
    },

    async saveAiInsight(id, insight) {
      const { count } = await prisma.distributionProposal.updateMany({
        where: { id },
        data: { aiInsight: json(insight) },
      });
      return count === 1;
    },
  };
}
