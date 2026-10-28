import type { AlertsService } from '../alerts/index.js';
import type { CustomerRepository } from '../customers/index.js';
import type {
  DistributionRepository,
  DistributionService,
  ProposalDetailDto,
} from '../distribution/index.js';
import type { PlanningActor } from '../distribution/distribution.service.js';
import { toProposalDetailDto } from '../distribution/distribution.dto.js';
import type { ProposalAiInsight } from '../distribution/distribution.repository.js';
import type { InventoryService } from '../inventory/index.js';
import type { InventoryMetricsService } from '../inventory/inventory-metrics.service.js';
import type { ProductRepository } from '../products/index.js';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/index.js';
import {
  toBriefingInput,
  toExplanationInput,
  toRescuePlanInput,
  topPendingOrders,
  type PlanLine,
} from './ai-context.js';
import { AiError } from './ai-error.js';
import type { AiGateway, AiResult } from './ai-gateway.js';
import { toProposalInsight } from './ai-insight.js';
import type { AiLocale, Briefing, RescuePlan } from './ai.schemas.js';

/** `{ data, meta }` of every /ai/* answer (contract 4.9). */
export interface AiResponse<T> {
  data: T;
  meta: {
    /** null when nothing had to be asked (e.g. no product at risk). */
    model: string | null;
    latencyMs: number;
    cached: boolean;
  };
}

export interface AiService {
  explainProposal(
    id: string,
    options: { locale: AiLocale; refresh: boolean },
    actor: PlanningActor,
  ): Promise<AiResponse<ProposalAiInsight>>;
  rescuePlan(locale: AiLocale, actor: PlanningActor): Promise<AiResponse<RescuePlan>>;
  briefing(locale: AiLocale, actor: PlanningActor): Promise<AiResponse<Briefing>>;
}

export interface AiServiceDeps {
  gateway: AiGateway;
  distribution: DistributionRepository;
  distributionService: DistributionService;
  products: ProductRepository;
  customers: CustomerRepository;
  metrics: InventoryMetricsService;
  inventory: InventoryService;
  alerts: AlertsService;
  clock: Clock;
}

/** Enough to see every customer type (there are five). */
const CUSTOMER_SCAN = { skip: 0, take: 500 };

/** Plan lines of a stored proposal, with what the AI may see. */
function planLinesOf(detail: ProposalDetailDto): PlanLine[] {
  return detail.orders.flatMap((order) =>
    order.lines.map((line) => ({
      orderItemId: line.orderItemId,
      orderCode: order.code,
      customerType: order.customerType,
      productName: line.productName,
      requestedQty: line.requestedQty,
      recommendedQty: line.recommendedQty,
      score: order.score,
      reasons: line.reasons,
    })),
  );
}

const fresh = <T, D = T>(answer: AiResult<T>, data: D): AiResponse<D> => ({
  data,
  meta: { model: answer.meta.model, latencyMs: answer.latencyMs, cached: false },
});

/** AI failures become 503 AI_UNAVAILABLE with details.category; the UI keeps the rules result. */
async function orUnavailable<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof AiError) throw error.toAppError();
    throw error;
  }
}

/**
 * The /ai endpoints: the backend builds every context from the database
 * (filtered by role, without customer personal data) and the client only
 * sends IDs and a locale.
 */
export function createAiService({
  gateway,
  distribution,
  distributionService,
  products,
  customers,
  metrics,
  inventory,
  alerts,
  clock,
}: AiServiceDeps): AiService {
  return {
    async explainProposal(id, { locale, refresh }, actor) {
      const proposal = await distribution.findProposal(id);
      if (!proposal) throw new AppError(404, 'NOT_FOUND', 'Proposal not found', { proposalId: id });

      const stored = proposal.aiInsight;
      if (!refresh && stored?.locale === locale) {
        return { data: stored, meta: { model: stored.model, latencyMs: 0, cached: true } };
      }

      const detail = toProposalDetailDto(proposal);
      const input = toExplanationInput(planLinesOf(detail), {
        locale,
        role: actor.role,
        strategy: detail.strategy,
      });
      if (input.lines.length === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'The proposal has no lines to explain', {
          reason: 'EMPTY_PROPOSAL',
        });
      }
      const answer = await orUnavailable(() => gateway.explainProposal(input, actor, id));
      const insight = toProposalInsight(answer, locale, clock());
      await distribution.saveAiInsight(id, insight);
      return fresh(answer, insight);
    },

    async rescuePlan(locale, actor) {
      const { items } = await products.list({ status: 'ACTIVE' });
      const [byProduct, activeCustomers] = await Promise.all([
        metrics.metricsFor(items.map((p) => ({ id: p.id, minStock: p.minStock.toNumber() }))),
        customers.list({ status: 'ACTIVE' }, CUSTOMER_SCAN),
      ]);
      const input = toRescuePlanInput(
        items.flatMap((product) => {
          const productMetrics = byProduct.get(product.id);
          return productMetrics
            ? [
                {
                  name: product.name,
                  category: product.category,
                  unit: product.unit,
                  metrics: productMetrics,
                },
              ]
            : [];
        }),
        activeCustomers.items.map((customer) => customer.type),
        locale,
      );
      // No product at risk: nothing to ask.
      if (input.products.length === 0) {
        return { data: { actions: [] }, meta: { model: null, latencyMs: 0, cached: false } };
      }
      const answer = await orUnavailable(() => gateway.rescuePlan(input, actor));
      return fresh(answer, answer.data);
    },

    async briefing(locale, actor) {
      const [alertList, summary, snapshot] = await Promise.all([
        alerts.list(),
        inventory.summary(),
        distributionService.snapshot(),
      ]);
      const input = toBriefingInput({
        locale,
        role: actor.role,
        alerts: alertList,
        pendingOrders: topPendingOrders(
          snapshot,
          new Map(snapshot.orders.map((order) => [order.id, order.customerType])),
        ),
        kpis: { ...summary, pendingOrders: snapshot.orders.length },
      });
      const answer = await orUnavailable(() => gateway.briefing(input, actor));
      return fresh(answer, answer.data);
    },
  };
}
