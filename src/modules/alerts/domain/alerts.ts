import {
  daysBetween,
  roundQty,
  toMilli,
  type CalendarDate,
  type ProductMetrics,
  type Reason,
} from '../../inventory/domain/index.js';
import { formatOrderCode, isOpen, type OrderStatus } from '../../orders/domain/index.js';
import { ALERT_RULES, type AlertRules } from './alert-rules.js';

export type AlertType =
  'LOW_STOCK' | 'EXPIRING_SOON' | 'WASTE_RISK' | 'SHORTAGE_RISK' | 'ORDER_DUE_SOON';

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type AlertCode =
  | 'OUT_OF_STOCK'
  | 'BELOW_MIN_STOCK'
  | 'EXPIRES_IN_DAYS'
  | 'COVERAGE_EXCEEDS_EXPIRY'
  | 'NO_RECENT_OUTFLOW'
  | 'PENDING_DEMAND_EXCEEDS_STOCK'
  | 'ORDER_DUE_IN_DAYS'
  | 'ORDER_OVERDUE';

/**
 * Contract alert (section 4.8): code + params, never translated text. Params
 * carry the product name or order code so the frontend can show it.
 */
export interface Alert {
  type: AlertType;
  severity: AlertSeverity;
  entity: 'Product' | 'Order';
  entityId: string;
  code: AlertCode;
  params: Record<string, number | string>;
}

export interface AlertProduct {
  id: string;
  name: string;
  minStock: number;
  /** From productMetrics, so alerts and ProductDTO never disagree. */
  metrics: ProductMetrics;
  /** Sum of requestedQty in PENDING orders. */
  pendingDemand: number;
}

export interface AlertOrder {
  id: string;
  number: number;
  status: OrderStatus;
  dueDate: CalendarDate;
}

export interface AlertsInput {
  /** Active products only; inactive ones raise no alerts. */
  products: readonly AlertProduct[];
  orders: readonly AlertOrder[];
  /** Business date in APP_TIMEZONE. */
  today: CalendarDate;
  rules?: AlertRules;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
const TYPE_RANK: Record<AlertType, number> = {
  LOW_STOCK: 0,
  SHORTAGE_RISK: 1,
  EXPIRING_SOON: 2,
  WASTE_RISK: 3,
  ORDER_DUE_SOON: 4,
};

function productAlerts(product: AlertProduct, rules: AlertRules): Alert[] {
  const { metrics } = product;
  const alerts: Alert[] = [];
  const alert = (
    type: AlertType,
    severity: AlertSeverity,
    code: AlertCode,
    params: Record<string, number | string>,
  ) =>
    alerts.push({
      type,
      severity,
      entity: 'Product',
      entityId: product.id,
      code,
      params: { name: product.name, ...params },
    });

  if (metrics.stockStatus === 'OUT') {
    alert('LOW_STOCK', 'CRITICAL', 'OUT_OF_STOCK', { minStock: product.minStock });
  } else if (metrics.stockStatus === 'LOW') {
    alert('LOW_STOCK', 'WARNING', 'BELOW_MIN_STOCK', {
      availableQty: metrics.availableQty,
      minStock: product.minStock,
    });
  }

  const days = metrics.daysToNearestExpiry;
  if (days !== null && metrics.nearestExpiry !== null && days <= rules.EXPIRY_WARNING_DAYS) {
    alert(
      'EXPIRING_SOON',
      days <= rules.CRITICAL_EXPIRY_DAYS ? 'CRITICAL' : 'WARNING',
      'EXPIRES_IN_DAYS',
      { days, expiryDate: metrics.nearestExpiry },
    );
  }

  if (metrics.wasteRisk === 'HIGH') {
    // The reason that made the risk HIGH explains the alert.
    const reason = metrics.reasons.find(
      (r): r is Reason & { code: 'COVERAGE_EXCEEDS_EXPIRY' | 'NO_RECENT_OUTFLOW' } =>
        r.code === 'COVERAGE_EXCEEDS_EXPIRY' || r.code === 'NO_RECENT_OUTFLOW',
    );
    if (reason) alert('WASTE_RISK', 'CRITICAL', reason.code, reason.params);
  }

  const demand = roundQty(product.pendingDemand);
  if (toMilli(demand) > toMilli(metrics.availableQty)) {
    alert('SHORTAGE_RISK', 'WARNING', 'PENDING_DEMAND_EXCEEDS_STOCK', {
      demand,
      available: metrics.availableQty,
    });
  }
  return alerts;
}

function orderAlert(order: AlertOrder, today: CalendarDate, rules: AlertRules): Alert | null {
  if (!isOpen(order.status)) return null;
  const days = daysBetween(today, order.dueDate);
  if (days > rules.ORDER_DUE_SOON_DAYS) return null;
  const base = {
    type: 'ORDER_DUE_SOON' as const,
    entity: 'Order' as const,
    entityId: order.id,
  };
  const orderCode = formatOrderCode(order.number);
  return days < 0
    ? {
        ...base,
        severity: 'CRITICAL',
        code: 'ORDER_OVERDUE',
        params: { orderCode, daysOverdue: -days },
      }
    : { ...base, severity: 'WARNING', code: 'ORDER_DUE_IN_DAYS', params: { orderCode, days } };
}

/**
 * Alerts computed on the fly (contract, section 4.8), most severe first, then
 * by type and entity id so the order is stable. Pure: no clock, no I/O.
 */
export function buildAlerts({
  products,
  orders,
  today,
  rules = ALERT_RULES,
}: AlertsInput): Alert[] {
  const alerts = [
    ...products.flatMap((product) => productAlerts(product, rules)),
    ...orders.flatMap((order) => orderAlert(order, today, rules) ?? []),
  ];
  return alerts.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      TYPE_RANK[a.type] - TYPE_RANK[b.type] ||
      (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0),
  );
}
