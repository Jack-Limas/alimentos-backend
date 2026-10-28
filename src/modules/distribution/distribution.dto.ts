import type { OrderPriority, OrderStatus, ProposalStatus, Strategy, Unit } from '@prisma/client';
import { fromDbDate, type CalendarDate } from '../inventory/domain/index.js';
import { formatOrderCode } from '../orders/domain/index.js';
import type {
  DistributionReason,
  FulfillmentStatus,
  ProposalSummary,
  ScoreComponents,
  Weights,
} from './domain/index.js';
import type { ProposalDetailRecord, ProposalRecord } from './distribution.repository.js';

export interface ProposalDto {
  id: string;
  strategy: Strategy;
  status: ProposalStatus;
  weights: Weights;
  businessDate: CalendarDate;
  processingMs: number;
  itemsProcessed: number;
  degraded: boolean;
  summary: ProposalSummary;
  createdById: string;
  confirmedById: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

export interface ProposalLineDto {
  id: string;
  orderItemId: string;
  productId: string;
  productName: string;
  unit: Unit;
  lotId: string | null;
  lotCode: string | null;
  lotExpiryDate: CalendarDate | null;
  requestedQty: number;
  availableQty: number;
  recommendedQty: number;
  reasons: DistributionReason[];
}

/** The lines of one order, with its place in the plan. */
export interface ProposalOrderDto {
  orderId: string;
  code: string;
  customerName: string;
  priority: OrderPriority;
  dueDate: CalendarDate;
  /** Current status of the order (it may have changed since the proposal). */
  orderStatus: OrderStatus;
  rank: number;
  score: number;
  components: ScoreComponents | null;
  fulfillment: FulfillmentStatus | null;
  rescores: number;
  lines: ProposalLineDto[];
}

export interface ProposalDetailDto extends ProposalDto {
  orders: ProposalOrderDto[];
}

export function toProposalDto(proposal: ProposalRecord): ProposalDto {
  const { ranking: _ranking, ...summary } = proposal.summary;
  return {
    id: proposal.id,
    strategy: proposal.strategy,
    status: proposal.status,
    weights: proposal.weights,
    businessDate: fromDbDate(proposal.businessDate),
    processingMs: proposal.processingMs,
    itemsProcessed: proposal.itemsProcessed,
    degraded: proposal.degraded,
    summary,
    createdById: proposal.createdById,
    confirmedById: proposal.confirmedById,
    confirmedAt: proposal.confirmedAt?.toISOString() ?? null,
    createdAt: proposal.createdAt.toISOString(),
  };
}

/** Lines grouped by order, in rank order (the order the plan serves them). */
export function toProposalDetailDto(proposal: ProposalDetailRecord): ProposalDetailDto {
  const ranking = new Map(proposal.summary.ranking.map((entry) => [entry.orderId, entry]));
  const groups = new Map<string, ProposalOrderDto>();

  for (const line of proposal.lines) {
    let group = groups.get(line.orderId);
    if (!group) {
      const ranked = ranking.get(line.orderId);
      group = {
        orderId: line.orderId,
        code: formatOrderCode(line.order.number),
        customerName: line.order.customerName,
        priority: line.order.priority,
        dueDate: fromDbDate(line.order.dueDate),
        orderStatus: line.order.status,
        rank: line.rank,
        score: line.score.toNumber(),
        components: ranked?.components ?? null,
        fulfillment: ranked?.status ?? null,
        rescores: ranked?.rescores ?? 0,
        lines: [],
      };
      groups.set(line.orderId, group);
    }
    group.lines.push({
      id: line.id,
      orderItemId: line.orderItemId,
      productId: line.productId,
      productName: line.product.name,
      unit: line.product.unit,
      lotId: line.lotId,
      lotCode: line.lot?.lotCode ?? null,
      lotExpiryDate: line.lot ? fromDbDate(line.lot.expiryDate) : null,
      requestedQty: line.requestedQty.toNumber(),
      availableQty: line.availableQty.toNumber(),
      recommendedQty: line.recommendedQty.toNumber(),
      reasons: line.reasons,
    });
  }

  // Stable display: by product name, then FEFO (lots without stock last).
  const byProductThenExpiry = (a: ProposalLineDto, b: ProposalLineDto) =>
    a.productName.localeCompare(b.productName, 'es') ||
    (a.lotExpiryDate ?? '9999-12-31').localeCompare(b.lotExpiryDate ?? '9999-12-31');
  return {
    ...toProposalDto(proposal),
    orders: [...groups.values()]
      .sort((a, b) => a.rank - b.rank)
      .map((group) => ({ ...group, lines: group.lines.sort(byProductThenExpiry) })),
  };
}
