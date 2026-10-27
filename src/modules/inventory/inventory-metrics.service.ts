import type { Clock } from '../../shared/clock.js';
import {
  fromDbDate,
  INVENTORY_RULES,
  productMetrics,
  todayIn,
  type CalendarDate,
  type InventoryRules,
  type MetricsLot,
  type ProductMetrics,
} from './domain/index.js';
import type { InventoryRepository } from './inventory.repository.js';

const DAY_MS = 86_400_000;

export interface MetricsProduct {
  id: string;
  minStock: number;
}

export interface InventoryMetricsService {
  /** Business date in APP_TIMEZONE. */
  today(): CalendarDate;
  /** Metrics of every given product, keyed by product id. Two queries in total. */
  metricsFor(products: readonly MetricsProduct[]): Promise<Map<string, ProductMetrics>>;
}

export interface InventoryMetricsDeps {
  inventory: InventoryRepository;
  clock: Clock;
  timeZone: string;
  rules?: InventoryRules;
}

export function createInventoryMetricsService({
  inventory,
  clock,
  timeZone,
  rules = INVENTORY_RULES,
}: InventoryMetricsDeps): InventoryMetricsService {
  return {
    today: () => todayIn(timeZone, clock()),

    async metricsFor(products) {
      if (products.length === 0) return new Map();
      const now = clock();
      const today = todayIn(timeZone, now);
      const since = new Date(now.getTime() - rules.OUTFLOW_WINDOW_DAYS * DAY_MS);
      const ids = products.map((product) => product.id);

      // No N+1: two aggregate queries for the whole page instead of two per product.
      const [stock, outflow] = await Promise.all([
        inventory.stockByExpiry(ids),
        inventory.dispatchedSince(since, ids),
      ]);

      // A Map keyed by product id joins both result sets in one pass each,
      // O(products + rows), instead of filtering the arrays once per product,
      // O(products × rows). It also gives every product a default (no stock, no
      // outflow) when it has no rows.
      const byProduct = new Map<string, { lots: MetricsLot[]; outflow: number }>(
        ids.map((id) => [id, { lots: [], outflow: 0 }]),
      );
      for (const row of stock) {
        byProduct.get(row.productId)?.lots.push({
          quantity: row.quantity.toNumber(),
          expiryDate: fromDbDate(row.expiryDate),
        });
      }
      for (const row of outflow) {
        const entry = byProduct.get(row.productId);
        if (entry) entry.outflow = row.quantity.toNumber();
      }

      return new Map(
        products.map((product) => {
          const entry = byProduct.get(product.id) ?? { lots: [], outflow: 0 };
          return [
            product.id,
            productMetrics(
              { minStock: product.minStock, lots: entry.lots },
              entry.outflow,
              today,
              rules,
            ),
          ];
        }),
      );
    },
  };
}
