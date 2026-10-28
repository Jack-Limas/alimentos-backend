import { allocateFefo, daysBetween, fromMilli, toMilli } from '../../inventory/domain/index.js';
import { formatOrderCode } from '../../orders/domain/index.js';
import { LotBook } from './lot-book.js';
import { MinHeap } from './min-heap.js';
import type { DistributionReason, OrderScore, ScoreComponents } from './score.js';
import type { DistributionSnapshot, SnapshotOrder, SnapshotProduct } from './snapshot.js';
import type { PrioritizationStrategy } from './strategies.js';
import { findTieGroups } from './ties.js';
import type { StrategyName, Weights } from './weights.js';

/** An order goes back to the heap at most this many times when its score drops. */
export const MAX_RESCORES = 3;

export type FulfillmentStatus = 'FULL' | 'PARTIAL' | 'UNSERVED';

export interface ProposalLineDraft {
  orderId: string;
  orderItemId: string;
  productId: string;
  /** null when the product had no dispatchable stock left. */
  lotId: string | null;
  /** Position of the order in the plan (1 = served first). */
  rank: number;
  /** Score of the order when it was served. */
  score: number;
  requestedQty: number;
  /** Dispatchable stock of the product left when the item was served. */
  availableQty: number;
  recommendedQty: number;
  reasons: DistributionReason[];
}

export interface RankedOrder {
  orderId: string;
  number: number;
  rank: number;
  score: number;
  components: ScoreComponents;
  status: FulfillmentStatus;
  /** Times the order went back to the heap because its score dropped. */
  rescores: number;
}

export interface ProposalSummary {
  strategy: StrategyName;
  weights: Weights;
  ordersFull: number;
  ordersPartial: number;
  ordersUnserved: number;
  /** Recommended quantity per unit (quantities of different units are never added). */
  totalRecommended: Partial<Record<SnapshotProduct['unit'], number>>;
  itemsProcessed: number;
  linesCount: number;
  rescoreCount: number;
  processingMs: number;
}

export interface ProposalResult {
  lines: ProposalLineDraft[];
  ranking: RankedOrder[];
  summary: ProposalSummary;
}

interface HeapEntry {
  order: SnapshotOrder;
  score: OrderScore;
  rescores: number;
}

/**
 * Highest score first. Ties: earlier due date, then older order, then lower
 * number, so the plan never depends on the input order.
 */
function compareEntries(a: HeapEntry, b: HeapEntry): number {
  if (a.score.score !== b.score.score) return b.score.score - a.score.score;
  if (a.order.dueDate !== b.order.dueDate) return a.order.dueDate < b.order.dueDate ? -1 : 1;
  if (a.order.createdAt !== b.order.createdAt)
    return a.order.createdAt < b.order.createdAt ? -1 : 1;
  return a.order.number - b.order.number;
}

/**
 * AI_ASSISTED: inside a group of tied orders (initial scores closer than
 * TIE_SCORE_DELTA) the given rank decides first, ranked orders before the
 * ones without a rank; between groups, and for every other order, the rules
 * comparator is unchanged. Groups come from the initial scores, so the order
 * stays total even when lazy re-scoring changes a score.
 */
function tieAwareComparator(
  entries: readonly HeapEntry[],
  ranks: ReadonlyMap<string, number>,
): (a: HeapEntry, b: HeapEntry) => number {
  const groupOf = new Map<string, number>();
  findTieGroups(
    entries.map((entry) => ({ key: entry.order.id, score: entry.score.score })),
  ).forEach((group, index) => {
    for (const orderId of group) groupOf.set(orderId, index);
  });
  const rankOf = (entry: HeapEntry) =>
    ranks.get(formatOrderCode(entry.order.number)) ?? Number.POSITIVE_INFINITY;

  return (a, b) => {
    const group = groupOf.get(a.order.id);
    if (group !== undefined && group === groupOf.get(b.order.id)) {
      const ra = rankOf(a);
      const rb = rankOf(b);
      if (ra !== rb) return ra < rb ? -1 : 1;
    }
    return compareEntries(a, b);
  };
}

export interface BuildOptions {
  /** Clock for processingMs; injectable so tests and fixtures stay deterministic. */
  now?: () => number;
  /**
   * orderCode → rank (lower first) for AI_ASSISTED. Only reorders orders
   * inside the same tie group, before the due date tie-breaker.
   */
  tieBreakRanks?: ReadonlyMap<string, number>;
}

/**
 * Builds a distribution plan (contract 4.7):
 * 1. Scores every PENDING order and pushes it to a min-heap.
 * 2. Pops the best one and re-scores it with the current lots. If its score
 *    dropped below the next order's, it goes back to the heap (lazy
 *    re-scoring, at most MAX_RESCORES times); otherwise it is served.
 * 3. Each item takes stock FEFO from dispatchable lots (expiring tomorrow or
 *    later), decrementing a Map<lotId, remaining>.
 * With tieBreakRanks (AI_ASSISTED), tied orders follow those ranks.
 * Pure and deterministic: the same snapshot and strategy give the same plan.
 */
export function buildProposal(
  snapshot: DistributionSnapshot,
  strategy: PrioritizationStrategy,
  { now = () => performance.now(), tieBreakRanks }: BuildOptions = {},
): ProposalResult {
  const started = now();
  const today = snapshot.businessDate;
  const lots = new LotBook(snapshot.lots, today);
  const units = new Map(snapshot.products.map((product) => [product.id, product.unit]));

  const initial: HeapEntry[] = snapshot.orders.map((order) => ({
    order,
    score: strategy.score(order, lots, today),
    rescores: 0,
  }));
  const compare =
    tieBreakRanks && tieBreakRanks.size > 0
      ? tieAwareComparator(initial, tieBreakRanks)
      : compareEntries;
  const heap = new MinHeap<HeapEntry>(compare);
  for (const entry of initial) heap.push(entry);

  const lines: ProposalLineDraft[] = [];
  const ranking: RankedOrder[] = [];
  const totals = new Map<SnapshotProduct['unit'], number>();
  let itemsProcessed = 0;
  let rescoreCount = 0;

  for (let entry = heap.pop(); entry; entry = heap.pop()) {
    const current = strategy.score(entry.order, lots, today);
    const next = heap.peek();
    const refreshed: HeapEntry = { ...entry, score: current };
    if (
      current.score < entry.score.score &&
      entry.rescores < MAX_RESCORES &&
      next !== undefined &&
      compare(refreshed, next) > 0
    ) {
      // Another order deserves to go first now: re-insert with the new score.
      heap.push({ ...refreshed, rescores: entry.rescores + 1 });
      rescoreCount += 1;
      continue;
    }

    const rank = ranking.length + 1;
    let served = 0;
    let full = 0;
    for (const item of entry.order.items) {
      itemsProcessed += 1;
      const availableQty = lots.available(item.productId);
      const base = { orderId: entry.order.id, orderItemId: item.id, productId: item.productId };
      const shared = { rank, score: current.score, requestedQty: item.requestedQty, availableQty };
      const orderReasons = current.reasons.filter((r) => r.code !== 'EXPIRES_IN_DAYS');

      if (toMilli(availableQty) === 0) {
        lines.push({
          ...base,
          ...shared,
          lotId: null,
          recommendedQty: 0,
          reasons: [
            ...orderReasons,
            { code: 'NO_STOCK', params: { requested: item.requestedQty } },
          ],
        });
        continue;
      }

      const result = allocateFefo(lots.lotsOf(item.productId), item.requestedQty, { today });
      const partial: DistributionReason[] =
        result.shortfall > 0
          ? [
              {
                code: 'PARTIAL_STOCK',
                params: { requested: item.requestedQty, allocated: result.allocatedQty },
              },
            ]
          : [];
      for (const allocation of result.allocations) {
        const expiry = lots.expiryOf(allocation.lotId, item.productId);
        lots.take(allocation.lotId, allocation.qty);
        lines.push({
          ...base,
          ...shared,
          lotId: allocation.lotId,
          recommendedQty: allocation.qty,
          reasons: [
            ...orderReasons,
            ...(expiry === null
              ? []
              : [
                  {
                    code: 'EXPIRES_IN_DAYS' as const,
                    params: { days: daysBetween(today, expiry) },
                  },
                ]),
            ...partial,
          ],
        });
      }
      const unit = units.get(item.productId);
      if (unit) totals.set(unit, toMilli(result.allocatedQty) + (totals.get(unit) ?? 0));
      if (result.allocatedQty > 0) served += 1;
      if (result.shortfall === 0) full += 1;
    }

    const items = entry.order.items.length;
    ranking.push({
      orderId: entry.order.id,
      number: entry.order.number,
      rank,
      score: current.score,
      components: current.components,
      status: full === items ? 'FULL' : served > 0 ? 'PARTIAL' : 'UNSERVED',
      rescores: entry.rescores,
    });
  }

  const count = (status: FulfillmentStatus) => ranking.filter((r) => r.status === status).length;
  return {
    lines,
    ranking,
    summary: {
      strategy: strategy.name,
      weights: { ...strategy.weights },
      ordersFull: count('FULL'),
      ordersPartial: count('PARTIAL'),
      ordersUnserved: count('UNSERVED'),
      totalRecommended: Object.fromEntries(
        [...totals]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([unit, milli]) => [unit, fromMilli(milli)]),
      ),
      itemsProcessed,
      linesCount: lines.length,
      rescoreCount,
      processingMs: Math.round((now() - started) * 1000) / 1000,
    },
  };
}
