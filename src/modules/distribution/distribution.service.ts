import { randomUUID } from 'node:crypto';
import type { Strategy } from '@prisma/client';
import { AUDIT_ACTIONS, buildAuditEntry } from '../audit/index.js';
import {
  addDays,
  fromDbDate,
  INVENTORY_RULES,
  todayIn,
  toDbDate,
  type CalendarDate,
} from '../inventory/domain/index.js';
import type { InventoryRepository } from '../inventory/inventory.repository.js';
import { formatOrderCode } from '../orders/domain/index.js';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/index.js';
import type { Actor } from '../../shared/http/actor.js';
import { paginate, toSkipTake, type Paginated } from '../../shared/http/pagination.js';
import {
  buildProposal,
  createStrategy,
  DEADLINE_HORIZON_DAYS,
  EXPIRY_HORIZON_DAYS,
  InvalidWeightsError,
  MAX_RESCORES,
  MIN_DAYS_TO_DISPATCH,
  StrategyNotAvailableError,
  STRATEGY_WEIGHTS,
  type DistributionSnapshot,
  type SnapshotProduct,
  type Weights,
} from './domain/index.js';
import {
  toProposalDetailDto,
  toProposalDto,
  type ProposalDetailDto,
  type ProposalDto,
} from './distribution.dto.js';
import {
  StaleProposalError,
  type DistributionRepository,
  type SnapshotOrderRow,
} from './distribution.repository.js';
import type { CreateProposalBody, ProposalListQuery } from './distribution.schemas.js';

const DAY_MS = 86_400_000;

/** GET /distribution/snapshot: what the browser engine needs, plus display fields. */
export interface SnapshotDto extends DistributionSnapshot {
  orders: (SnapshotOrderRow & { code: string })[];
  products: (SnapshotProduct & { name: string })[];
  strategies: typeof STRATEGY_WEIGHTS;
  rules: {
    minDaysToDispatch: number;
    deadlineHorizonDays: number;
    expiryHorizonDays: number;
    maxRescores: number;
  };
}

export interface DistributionService {
  snapshot(): Promise<SnapshotDto>;
  createProposal(input: CreateProposalBody, actor: Actor): Promise<ProposalDetailDto>;
  list(query: ProposalListQuery): Promise<Paginated<ProposalDto>>;
  get(id: string): Promise<ProposalDetailDto>;
  confirm(id: string, actor: Actor): Promise<ProposalDetailDto>;
  discard(id: string, actor: Actor): Promise<ProposalDetailDto>;
}

export interface DistributionServiceDeps {
  distribution: DistributionRepository;
  inventory: InventoryRepository;
  clock: Clock;
  timeZone: string;
  newId?: () => string;
  /** Clock for processingMs (performance.now by default). */
  now?: () => number;
}

function notFound(id: string): AppError {
  return new AppError(404, 'NOT_FOUND', 'Proposal not found', { proposalId: id });
}

function stale(reason: string, details: Record<string, unknown> = {}): AppError {
  return new AppError(409, 'STALE_PROPOSAL', 'The proposal no longer matches the inventory', {
    reason,
    ...details,
  });
}

export function createDistributionService({
  distribution,
  inventory,
  clock,
  timeZone,
  newId = randomUUID,
  now = () => performance.now(),
}: DistributionServiceDeps): DistributionService {
  const today = (): CalendarDate => todayIn(timeZone, clock());

  async function snapshot(): Promise<SnapshotDto> {
    const businessDate = today();
    const rows = await distribution.loadSnapshot(
      toDbDate(addDays(businessDate, MIN_DAYS_TO_DISPATCH)),
    );
    // One grouped query for the 30-day outflow of every product in the snapshot.
    const since = new Date(clock().getTime() - INVENTORY_RULES.OUTFLOW_WINDOW_DAYS * DAY_MS);
    const outflow = new Map(
      (
        await inventory.dispatchedSince(
          since,
          rows.products.map((p) => p.id),
        )
      ).map((row) => [row.productId, row.quantity.toNumber()]),
    );
    const round3 = (value: number) => Math.round(value * 1000) / 1000;

    return {
      businessDate,
      orders: rows.orders.map((order) => ({ ...order, code: formatOrderCode(order.number) })),
      lots: rows.lots,
      products: rows.products.map((product) => ({
        ...product,
        avgDailyOut30d: round3(
          (outflow.get(product.id) ?? 0) / INVENTORY_RULES.OUTFLOW_WINDOW_DAYS,
        ),
      })),
      strategies: STRATEGY_WEIGHTS,
      rules: {
        minDaysToDispatch: MIN_DAYS_TO_DISPATCH,
        deadlineHorizonDays: DEADLINE_HORIZON_DAYS,
        expiryHorizonDays: EXPIRY_HORIZON_DAYS,
        maxRescores: MAX_RESCORES,
      },
    };
  }

  function strategyFor(name: Strategy, weights: Weights | undefined) {
    try {
      return createStrategy(name, weights);
    } catch (error) {
      if (error instanceof StrategyNotAvailableError) {
        throw new AppError(400, 'STRATEGY_NOT_AVAILABLE', 'This strategy is not available yet', {
          strategy: name,
        });
      }
      if (error instanceof InvalidWeightsError) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Weights must add up to 100', {
          field: 'weights',
          problem: error.problem,
        });
      }
      throw error;
    }
  }

  async function detail(id: string): Promise<ProposalDetailDto> {
    const proposal = await distribution.findProposal(id);
    if (!proposal) throw notFound(id);
    return toProposalDetailDto(proposal);
  }

  return {
    snapshot,

    async createProposal({ strategy: name, weights }, actor) {
      // Validate the strategy before touching the database.
      const strategy = strategyFor(name, weights);
      const data = await snapshot();
      const result = buildProposal(data, strategy, { now });
      const id = newId();

      await distribution.createProposal({
        id,
        strategy: name,
        weights: { ...strategy.weights },
        businessDate: toDbDate(data.businessDate),
        processingMs: Math.round(result.summary.processingMs),
        itemsProcessed: result.summary.itemsProcessed,
        summary: { ...result.summary, ranking: result.ranking },
        createdById: actor.userId,
        lines: result.lines.map((line) => ({ ...line, id: newId() })),
        audit: buildAuditEntry({
          userId: actor.userId,
          action: AUDIT_ACTIONS.PROPOSAL_CREATED,
          entity: 'DistributionProposal',
          entityId: id,
          metadata: {
            strategy: name,
            orders: result.ranking.length,
            lines: result.lines.length,
            processingMs: result.summary.processingMs,
          },
          ip: actor.ip,
        }),
      });
      return detail(id);
    },

    async list(query) {
      const { items, total } = await distribution.listProposals(
        { status: query.status },
        toSkipTake(query),
      );
      return paginate(items.map(toProposalDto), total, query);
    },

    get: detail,

    async confirm(id, actor) {
      const proposal = await distribution.findProposal(id);
      if (!proposal) throw notFound(id);
      if (proposal.status !== 'DRAFT') throw stale('NOT_DRAFT', { status: proposal.status });
      // Lot eligibility depends on the day: a plan from yesterday may ship a lot that expires today.
      const businessDate = today();
      if (fromDbDate(proposal.businessDate) !== businessDate) {
        throw stale('BUSINESS_DATE_CHANGED', {
          proposalDate: fromDbDate(proposal.businessDate),
          today: businessDate,
        });
      }

      const allocations = proposal.lines.flatMap((line) =>
        line.lotId !== null && line.recommendedQty.gt(0)
          ? [
              {
                movementId: newId(),
                orderId: line.orderId,
                orderItemId: line.orderItemId,
                productId: line.productId,
                lotId: line.lotId,
                qty: line.recommendedQty.toNumber(),
              },
            ]
          : [],
      );
      const orderIds = [...new Set(allocations.map((allocation) => allocation.orderId))];

      try {
        await distribution.confirm({
          proposalId: id,
          userId: actor.userId,
          confirmedAt: clock(),
          allocations,
          orders: orderIds.map((orderId) => ({ orderId, historyId: newId() })),
          note: `proposal:${id}`,
          audit: buildAuditEntry({
            userId: actor.userId,
            action: AUDIT_ACTIONS.PROPOSAL_CONFIRMED,
            entity: 'DistributionProposal',
            entityId: id,
            metadata: {
              strategy: proposal.strategy,
              movements: allocations.length,
              ordersToPreparation: orderIds.length,
            },
            ip: actor.ip,
          }),
        });
      } catch (error) {
        if (error instanceof StaleProposalError) throw stale(error.reason, error.details);
        throw error;
      }
      return detail(id);
    },

    async discard(id, actor) {
      const proposal = await distribution.findProposal(id);
      if (!proposal) throw notFound(id);
      const discarded = await distribution.discard(
        id,
        buildAuditEntry({
          userId: actor.userId,
          action: AUDIT_ACTIONS.PROPOSAL_DISCARDED,
          entity: 'DistributionProposal',
          entityId: id,
          metadata: { strategy: proposal.strategy },
          ip: actor.ip,
        }),
      );
      if (!discarded) {
        throw new AppError(409, 'INVALID_STATUS_TRANSITION', 'Only a DRAFT can be discarded', {
          status: proposal.status,
        });
      }
      return detail(id);
    },
  };
}
