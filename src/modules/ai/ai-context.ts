import type { CustomerType, ProductCategory, Role, Unit } from '@prisma/client';
import type { Alert } from '../alerts/domain/index.js';
import {
  BalancedStrategy,
  LotBook,
  type DistributionReason,
  type DistributionSnapshot,
  type OrderPriority,
} from '../distribution/domain/index.js';
import type { CalendarDate, ProductMetrics } from '../inventory/domain/index.js';
import { formatOrderCode } from '../orders/domain/index.js';
import type { AiLocale } from './ai.schemas.js';

/**
 * The backend builds every AI input from the database; the client only sends
 * IDs and a locale. Data minimization: customers travel as their type, never
 * their name, email or phone. Limits mirror alimentos-ai (contract 5).
 */
export const MAX_AI_ITEMS = 200;
export const MAX_AI_TEXT = 120;
export const BRIEFING_TOP_ORDERS = 10;

export type AiRole = Extract<Role, 'ADMIN' | 'OPERATOR'>;

export interface ExplanationLine {
  orderCode: string;
  customerType: CustomerType;
  product: string;
  requestedQty: number;
  recommendedQty: number;
  score: number;
  reasons: DistributionReason[];
}

export interface ProposalExplanationInput {
  locale: AiLocale;
  role: AiRole;
  strategy: string;
  lines: ExplanationLine[];
}

export interface RescueProduct {
  name: string;
  category: ProductCategory;
  qty: number;
  unit: Unit;
  daysToExpiry: number;
  avgDailyOut: number;
}

export interface RescuePlanInput {
  locale: AiLocale;
  products: RescueProduct[];
  customerTypes: CustomerType[];
}

export interface BriefingAlert {
  type: string;
  severity: Alert['severity'];
  code: string;
  params: { count: number };
}

export interface BriefingOrder {
  orderCode: string;
  priority: OrderPriority;
  dueDate: CalendarDate;
  customerType?: CustomerType;
}

export interface BriefingInput {
  locale: AiLocale;
  role: AiRole;
  alerts: BriefingAlert[];
  pendingOrders: BriefingOrder[];
  kpis: Record<string, number>;
}

const clip = (text: string) => text.trim().slice(0, MAX_AI_TEXT);

/** One line of a plan, as stored: (order item, lot) pairs. */
export interface PlanLine {
  orderItemId: string;
  orderCode: string;
  customerType: CustomerType;
  productName: string;
  requestedQty: number;
  recommendedQty: number;
  score: number;
  reasons: DistributionReason[];
}

/**
 * One AI line per order item (the lots of an item are added up), in plan
 * order, at most MAX_AI_ITEMS. Reasons are kept once per code.
 */
export function toExplanationInput(
  lines: readonly PlanLine[],
  options: { locale: AiLocale; role: AiRole; strategy: string },
): ProposalExplanationInput {
  const byItem = new Map<string, ExplanationLine>();
  for (const line of lines) {
    const current = byItem.get(line.orderItemId);
    if (current) {
      current.recommendedQty =
        Math.round((current.recommendedQty + line.recommendedQty) * 1000) / 1000;
      for (const reason of line.reasons) {
        if (!current.reasons.some((known) => known.code === reason.code))
          current.reasons.push(reason);
      }
      continue;
    }
    if (byItem.size >= MAX_AI_ITEMS) continue;
    byItem.set(line.orderItemId, {
      orderCode: line.orderCode,
      customerType: line.customerType,
      product: clip(line.productName),
      requestedQty: line.requestedQty,
      recommendedQty: line.recommendedQty,
      score: line.score,
      reasons: [...line.reasons],
    });
  }
  return { ...options, lines: [...byItem.values()] };
}

export interface RescueCandidate {
  name: string;
  category: ProductCategory;
  unit: Unit;
  metrics: ProductMetrics;
}

/**
 * Products with wasteRisk HIGH (the same metrics as the alerts), nearest
 * expiry first, plus the types of the active customers that could take them.
 */
export function toRescuePlanInput(
  candidates: readonly RescueCandidate[],
  customerTypes: readonly CustomerType[],
  locale: AiLocale,
): RescuePlanInput {
  const products = candidates
    .filter(
      (candidate) =>
        candidate.metrics.wasteRisk === 'HIGH' && candidate.metrics.daysToNearestExpiry !== null,
    )
    .map((candidate) => ({
      name: clip(candidate.name),
      category: candidate.category,
      qty: candidate.metrics.availableQty,
      unit: candidate.unit,
      daysToExpiry: candidate.metrics.daysToNearestExpiry ?? 0,
      avgDailyOut: candidate.metrics.avgDailyOut30d,
    }))
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry || a.name.localeCompare(b.name, 'es'))
    .slice(0, MAX_AI_ITEMS);
  return { locale, products, customerTypes: [...new Set(customerTypes)].sort() };
}

/**
 * The pending orders that matter most today: BALANCED score with the current
 * lots, ties by due date and number (like the engine), the first `limit`.
 */
export function topPendingOrders(
  snapshot: DistributionSnapshot,
  customerTypes: ReadonlyMap<string, CustomerType>,
  limit = BRIEFING_TOP_ORDERS,
): BriefingOrder[] {
  const strategy = new BalancedStrategy();
  const lots = new LotBook(snapshot.lots, snapshot.businessDate);
  return snapshot.orders
    .map((order) => ({ order, score: strategy.score(order, lots, snapshot.businessDate).score }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.order.dueDate.localeCompare(b.order.dueDate) ||
        a.order.number - b.order.number,
    )
    .slice(0, limit)
    .map(({ order }) => {
      const customerType = customerTypes.get(order.id);
      return {
        orderCode: formatOrderCode(order.number),
        priority: order.priority,
        dueDate: order.dueDate,
        ...(customerType ? { customerType } : {}),
      };
    });
}

/** Alert types an OPERATOR sees in the briefing; WASTE_RISK is a management view. */
export const OPERATOR_ALERT_TYPES: ReadonlySet<string> = new Set([
  'LOW_STOCK',
  'EXPIRING_SOON',
  'SHORTAGE_RISK',
  'ORDER_DUE_SOON',
]);

/** KPIs an OPERATOR gets: warehouse work, not catalog or waste management. */
export const OPERATOR_KPIS: ReadonlySet<string> = new Set([
  'lowStock',
  'outOfStock',
  'expiringSoon',
  'pendingOrders',
]);

/**
 * Alert counts by (type, severity, code), never the alerts themselves; the
 * top pending orders; the inventory KPIs. The OPERATOR gets operational data
 * only: no waste-risk alerts or management KPIs, no customer types.
 */
export function toBriefingInput({
  locale,
  role,
  alerts,
  pendingOrders,
  kpis,
}: {
  locale: AiLocale;
  role: AiRole;
  alerts: readonly Alert[];
  pendingOrders: readonly BriefingOrder[];
  kpis: Record<string, number>;
}): BriefingInput {
  const operator = role === 'OPERATOR';
  const counts = new Map<string, BriefingAlert>();
  for (const alert of alerts) {
    if (operator && !OPERATOR_ALERT_TYPES.has(alert.type)) continue;
    const key = `${alert.type}|${alert.severity}|${alert.code}`;
    const entry = counts.get(key);
    if (entry) entry.params.count += 1;
    else
      counts.set(key, {
        type: alert.type,
        severity: alert.severity,
        code: alert.code,
        params: { count: 1 },
      });
  }
  const severityRank = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
  return {
    locale,
    role,
    alerts: [...counts.values()].sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] ||
        a.type.localeCompare(b.type) ||
        a.code.localeCompare(b.code),
    ),
    pendingOrders: pendingOrders.map(({ customerType, ...order }) =>
      operator || customerType === undefined ? order : { ...order, customerType },
    ),
    kpis: Object.fromEntries(
      Object.entries(kpis).filter(([key]) => !operator || OPERATOR_KPIS.has(key)),
    ),
  };
}
