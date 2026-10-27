import { addDays, fromDbDate, toDbDate } from '../inventory/domain/index.js';
import type { InventoryMetricsService } from '../inventory/inventory-metrics.service.js';
import type { OrderRepository } from '../orders/order.repository.js';
import type { ProductRepository } from '../products/product.repository.js';
import { ALERT_RULES, buildAlerts, type Alert, type AlertRules } from './domain/index.js';

export interface AlertsService {
  list(): Promise<Alert[]>;
}

export interface AlertsServiceDeps {
  products: ProductRepository;
  orders: OrderRepository;
  metrics: InventoryMetricsService;
  rules?: AlertRules;
}

export function createAlertsService({
  products,
  orders,
  metrics,
  rules = ALERT_RULES,
}: AlertsServiceDeps): AlertsService {
  return {
    async list() {
      const today = metrics.today();
      const { items } = await products.list({ status: 'ACTIVE' });

      // No N+1: the metrics take two grouped queries for every product, the
      // pending demand one more, and the due orders one, whatever the catalog size.
      const [metricsByProduct, demand, dueOrders] = await Promise.all([
        metrics.metricsFor(items.map((p) => ({ id: p.id, minStock: p.minStock.toNumber() }))),
        orders.pendingDemand(),
        orders.openOrdersDueBy(toDbDate(addDays(today, rules.ORDER_DUE_SOON_DAYS))),
      ]);

      // A Map joins the grouped demand to the products in one pass each.
      const demandByProduct = new Map(
        demand.map((row) => [row.productId, row.quantity.toNumber()]),
      );

      return buildAlerts({
        products: items.flatMap((product) => {
          const productMetrics = metricsByProduct.get(product.id);
          if (!productMetrics) return [];
          return {
            id: product.id,
            name: product.name,
            minStock: product.minStock.toNumber(),
            metrics: productMetrics,
            pendingDemand: demandByProduct.get(product.id) ?? 0,
          };
        }),
        orders: dueOrders.map((order) => ({
          id: order.id,
          number: order.number,
          status: order.status,
          dueDate: fromDbDate(order.dueDate),
        })),
        today,
        rules,
      });
    },
  };
}
