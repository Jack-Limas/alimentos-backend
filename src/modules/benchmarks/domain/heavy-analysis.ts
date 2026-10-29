import { createRandom } from '../../../seed/random.js';
import {
  BalancedStrategy,
  buildProposal,
  type DistributionSnapshot,
  type OrderPriority,
} from '../../distribution/domain/index.js';
import { addDays, productMetrics, type CalendarDate } from '../../inventory/domain/index.js';

export const BENCH_BUSINESS_DATE: CalendarDate = '2026-10-28';
export const BENCH_DEFAULT_SEED = 20_261_028;

const PRIORITIES: readonly OrderPriority[] = ['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'URGENT'];
const UNITS = ['KG', 'L', 'UNIT', 'BOX'] as const;

export interface BenchSnapshot extends DistributionSnapshot {
  /** Minimum stock and 30-day outflow per product, for productMetrics. */
  stockRules: { productId: string; minStock: number; outflow30d: number }[];
}

/**
 * A deterministic synthetic warehouse of `size` PENDING orders (1–4 items
 * each) over a catalog that grows with the size, with 1–4 lots per product.
 * No clock and no Math.random: the same size and seed give the same data,
 * so the main thread and the pool compute exactly the same thing.
 */
export function generateBenchSnapshot(size: number, seed = BENCH_DEFAULT_SEED): BenchSnapshot {
  const random = createRandom(seed);
  const today = BENCH_BUSINESS_DATE;
  const base = Date.parse(`${today}T12:00:00.000Z`);
  const productCount = Math.min(2_000, Math.max(50, Math.round(size / 10)));

  const products = Array.from({ length: productCount }, (_, i) => ({
    id: `p-${String(i + 1)}`,
    unit: UNITS[i % UNITS.length] ?? 'KG',
    avgDailyOut30d: random.int(0, 40) / 2,
  }));
  const lots = products.flatMap((product) =>
    Array.from({ length: random.int(1, 4) }, (_, j) => ({
      id: `${product.id}-l${String(j + 1)}`,
      productId: product.id,
      quantity: random.int(0, 40) * 25,
      expiryDate: addDays(today, random.int(-2, 45)),
      receivedAt: new Date(base - random.int(1, 30) * 86_400_000).toISOString(),
    })),
  );
  const orders = Array.from({ length: size }, (_, i) => {
    const used = new Set<number>();
    const items = Array.from({ length: random.int(1, 4) }, (_, k) => {
      let index = random.int(0, productCount - 1);
      while (used.has(index)) index = (index + 1) % productCount;
      used.add(index);
      return {
        id: `o-${String(i + 1)}-i${String(k + 1)}`,
        productId: products[index]?.id ?? 'p-1',
        requestedQty: random.int(1, 120) / 2,
      };
    });
    return {
      id: `o-${String(i + 1)}`,
      number: i + 1,
      priority: PRIORITIES[random.int(0, PRIORITIES.length - 1)] ?? 'MEDIUM',
      dueDate: addDays(today, random.int(-2, 14)),
      createdAt: new Date(base - random.int(1, 20 * 24 * 60) * 60_000).toISOString(),
      items,
    };
  });
  const stockRules = products.map((product) => ({
    productId: product.id,
    minStock: random.int(0, 200),
    outflow30d: product.avgDailyOut30d * 30,
  }));

  return { businessDate: today, orders, lots, products, stockRules };
}

export interface HeavyAnalysisResult {
  size: number;
  products: number;
  lots: number;
  wasteRiskHigh: number;
  lowOrOut: number;
  ordersFull: number;
  ordersPartial: number;
  ordersUnserved: number;
  linesCount: number;
  /** Sum of the plan scores: equal on both sides proves they computed the same plan. */
  checksum: number;
}

/**
 * The CPU-heavy job of the benchmark: product metrics for the whole catalog
 * plus a full distribution plan. Pure and synchronous.
 */
export function runHeavyAnalysis(size: number, seed = BENCH_DEFAULT_SEED): HeavyAnalysisResult {
  const snapshot = generateBenchSnapshot(size, seed);
  const lotsByProduct = new Map<string, { quantity: number; expiryDate: CalendarDate }[]>();
  for (const lot of snapshot.lots) {
    lotsByProduct.set(lot.productId, [
      ...(lotsByProduct.get(lot.productId) ?? []),
      { quantity: lot.quantity, expiryDate: lot.expiryDate },
    ]);
  }
  let wasteRiskHigh = 0;
  let lowOrOut = 0;
  for (const rule of snapshot.stockRules) {
    const metrics = productMetrics(
      { minStock: rule.minStock, lots: lotsByProduct.get(rule.productId) ?? [] },
      rule.outflow30d,
      snapshot.businessDate,
    );
    if (metrics.wasteRisk === 'HIGH') wasteRiskHigh += 1;
    if (metrics.stockStatus !== 'OK') lowOrOut += 1;
  }

  const plan = buildProposal(snapshot, new BalancedStrategy(), { now: () => 0 });
  return {
    size,
    products: snapshot.products.length,
    lots: snapshot.lots.length,
    wasteRiskHigh,
    lowOrOut,
    ordersFull: plan.summary.ordersFull,
    ordersPartial: plan.summary.ordersPartial,
    ordersUnserved: plan.summary.ordersUnserved,
    linesCount: plan.summary.linesCount,
    checksum: Math.round(plan.ranking.reduce((sum, entry) => sum + entry.score, 0) * 100) / 100,
  };
}
