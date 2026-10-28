import { describe, expect, it } from 'vitest';
import {
  BalancedStrategy,
  buildProposal,
  checkWeights,
  createStrategy,
  InvalidWeightsError,
  LotBook,
  scoreOrder,
  StrategyNotAvailableError,
  UrgencyFirstStrategy,
  WasteFirstStrategy,
} from '../src/modules/distribution/domain/index.js';
import { fixedClock, lot, order, snapshot, TODAY } from './helpers/distribution-fixtures.js';

const balanced = new BalancedStrategy();
const book = (lots: Parameters<typeof snapshot>[1]) => new LotBook(lots, TODAY);
const ranked = (result: ReturnType<typeof buildProposal>) => result.ranking.map((r) => r.number);

describe('scoreOrder components', () => {
  it.each([
    ['LOW', 0.25],
    ['MEDIUM', 0.5],
    ['HIGH', 0.75],
    ['URGENT', 1],
  ] as const)('priority %s is %d', (priority, value) => {
    const result = scoreOrder(
      order(1, priority, 100, [['p', 1]]),
      book([]),
      TODAY,
      balanced.weights,
    );
    expect(result.components.priority).toBe(value);
    expect(result.reasons[0]).toEqual({ code: `PRIORITY_${priority}`, params: {} });
  });

  it.each([
    [14, 0],
    [7, 0.5],
    [0, 1],
    [-3, 1],
    [30, 0],
  ])('deadline urgency for a due date in %i days is %d', (days, value) => {
    const result = scoreOrder(order(1, 'LOW', days, [['p', 1]]), book([]), TODAY, balanced.weights);
    expect(result.components.deadlineUrgency).toBe(value);
  });

  it('reports overdue orders with the days late', () => {
    const result = scoreOrder(order(1, 'LOW', -2, [['p', 1]]), book([]), TODAY, balanced.weights);
    expect(result.reasons).toContainEqual({ code: 'OVERDUE', params: { days: 2 } });
  });

  it('expiry pressure uses the FEFO lot of the most pressing item', () => {
    const lots = book([lot('a', 'p1', 5, 15), lot('b', 'p2', 5, 3), lot('c', 'p2', 5, 1)]);
    const result = scoreOrder(
      order(1, 'LOW', 30, [
        ['p1', 1],
        ['p2', 1],
      ]),
      lots,
      TODAY,
      balanced.weights,
    );
    expect(result.components.expiryPressure).toBe(0.9667);
    expect(result.reasons).toContainEqual({ code: 'EXPIRES_IN_DAYS', params: { days: 1 } });
  });

  it('expiry pressure is 0 without dispatchable stock', () => {
    const result = scoreOrder(
      order(1, 'LOW', 30, [['p', 1]]),
      book([lot('x', 'p', 5, 0)]),
      TODAY,
      balanced.weights,
    );
    expect(result.components.expiryPressure).toBe(0);
  });

  it('weights the components into a 0–100 score with 2 decimals', () => {
    // 40·1 + 35·1 + 25·(1 − 1/30) = 99.17
    const result = scoreOrder(
      order(1, 'URGENT', 0, [['p', 1]]),
      book([lot('a', 'p', 5, 1)]),
      TODAY,
      balanced.weights,
    );
    expect(result.score).toBe(99.17);
  });
});

describe('strategies', () => {
  // O1 urgent but not due soon; O2 low priority due today; O3 low priority with a lot expiring tomorrow.
  const fixture = snapshot(
    [
      order(1, 'URGENT', 10, [['p1', 1]]),
      order(2, 'LOW', 0, [['p2', 1]]),
      order(3, 'LOW', 10, [['p3', 1]]),
    ],
    [lot('l1', 'p1', 10, 25), lot('l2', 'p2', 10, 25), lot('l3', 'p3', 10, 1)],
  );

  it('give three different rankings on the same snapshot', () => {
    expect(ranked(buildProposal(fixture, new BalancedStrategy(), fixedClock))).toEqual([1, 2, 3]);
    expect(ranked(buildProposal(fixture, new UrgencyFirstStrategy(), fixedClock))).toEqual([
      2, 1, 3,
    ]);
    expect(ranked(buildProposal(fixture, new WasteFirstStrategy(), fixedClock))).toEqual([3, 1, 2]);
  });

  it('use their documented default weights', () => {
    expect(createStrategy('BALANCED').weights).toEqual({
      priority: 40,
      deadlineUrgency: 35,
      expiryPressure: 25,
    });
    expect(createStrategy('URGENCY_FIRST').weights).toEqual({
      priority: 20,
      deadlineUrgency: 70,
      expiryPressure: 10,
    });
    expect(createStrategy('WASTE_FIRST').weights).toEqual({
      priority: 20,
      deadlineUrgency: 20,
      expiryPressure: 60,
    });
  });

  it('accept custom weights that add up to 100', () => {
    const custom = createStrategy('BALANCED', {
      priority: 0,
      deadlineUrgency: 0,
      expiryPressure: 100,
    });
    expect(ranked(buildProposal(fixture, custom, fixedClock))[0]).toBe(3);
    expect(
      checkWeights({ priority: 33.33, deadlineUrgency: 33.33, expiryPressure: 33.34 }),
    ).toBeNull();
  });

  it.each([
    [{ priority: 50, deadlineUrgency: 50, expiryPressure: 1 }, 'SUM_NOT_100'],
    [{ priority: 120, deadlineUrgency: -20, expiryPressure: 0 }, 'NEGATIVE'],
    [{ priority: 33.333, deadlineUrgency: 33.333, expiryPressure: 33.334 }, 'TOO_MANY_DECIMALS'],
  ])('reject weights %o (%s)', (weights, problem) => {
    expect(checkWeights(weights)).toBe(problem);
    expect(() => createStrategy('BALANCED', weights)).toThrow(InvalidWeightsError);
  });

  it('declare AI_ASSISTED but refuse it in this phase', () => {
    expect(() => createStrategy('AI_ASSISTED')).toThrow(StrategyNotAvailableError);
  });
});

describe('buildProposal', () => {
  it('re-scores lazily: an order whose expiry pressure dropped waits behind the next one', () => {
    // A (urgent, due today) takes the lot expiring tomorrow; B scored 61.67 with that lot,
    // but only the lot expiring in 29 days is left (38.33), so C (50) goes before it.
    const fixture = snapshot(
      [
        order(1, 'URGENT', 0, [['x', 10]]),
        order(2, 'MEDIUM', 7, [['x', 5]]),
        order(3, 'MEDIUM', 7, [['y', 5]]),
      ],
      [lot('soon', 'x', 10, 1), lot('later', 'x', 50, 29), lot('mid', 'y', 50, 15)],
    );
    const result = buildProposal(fixture, balanced, fixedClock);

    expect(ranked(result)).toEqual([1, 3, 2]);
    expect(result.ranking.map((r) => r.score)).toEqual([99.17, 50, 38.33]);
    expect(result.ranking.find((r) => r.number === 2)?.rescores).toBe(1);
    expect(result.summary.rescoreCount).toBe(1);
  });

  it('allocates FEFO across lots and writes one line per item and lot', () => {
    const fixture = snapshot(
      [order(1, 'HIGH', 3, [['x', 12]])],
      [lot('b', 'x', 10, 9), lot('a', 'x', 5, 4)],
    );
    const result = buildProposal(fixture, balanced, fixedClock);

    expect(result.lines.map((l) => [l.lotId, l.recommendedQty, l.availableQty])).toEqual([
      ['a', 5, 15],
      ['b', 7, 15],
    ]);
    expect(result.lines[0]?.reasons).toContainEqual({
      code: 'EXPIRES_IN_DAYS',
      params: { days: 4 },
    });
    expect(result.ranking[0]?.status).toBe('FULL');
  });

  it('marks partial stock and keeps serving what is there', () => {
    const fixture = snapshot([order(1, 'HIGH', 3, [['x', 8.5]])], [lot('a', 'x', 3.25, 5)]);
    const [line] = buildProposal(fixture, balanced, fixedClock).lines;

    expect(line).toMatchObject({
      lotId: 'a',
      requestedQty: 8.5,
      availableQty: 3.25,
      recommendedQty: 3.25,
    });
    expect(line?.reasons).toContainEqual({
      code: 'PARTIAL_STOCK',
      params: { requested: 8.5, allocated: 3.25 },
    });
  });

  it('writes a NO_STOCK line without lot when nothing is left', () => {
    const fixture = snapshot(
      [
        order(1, 'URGENT', 0, [['x', 10]]),
        order(2, 'LOW', 9, [
          ['x', 4],
          ['y', 1],
        ]),
      ],
      [lot('a', 'x', 10, 5), lot('b', 'y', 1, 5)],
    );
    const result = buildProposal(fixture, balanced, fixedClock);
    const noStock = result.lines.find((l) => l.orderId === 'order-2' && l.productId === 'x');

    expect(noStock).toMatchObject({ lotId: null, recommendedQty: 0, availableQty: 0 });
    expect(noStock?.reasons).toContainEqual({ code: 'NO_STOCK', params: { requested: 4 } });
    expect(result.ranking.map((r) => r.status)).toEqual(['FULL', 'PARTIAL']);
  });

  it('never dispatches a lot that expires today, but does use one that expires tomorrow', () => {
    const today = buildProposal(
      snapshot([order(1, 'HIGH', 1, [['x', 2]])], [lot('t', 'x', 9, 0)]),
      balanced,
      fixedClock,
    );
    const tomorrow = buildProposal(
      snapshot([order(1, 'HIGH', 1, [['x', 2]])], [lot('m', 'x', 9, 1)]),
      balanced,
      fixedClock,
    );

    expect(today.lines[0]).toMatchObject({ lotId: null, recommendedQty: 0 });
    expect(today.ranking[0]?.status).toBe('UNSERVED');
    expect(tomorrow.lines[0]).toMatchObject({ lotId: 'm', recommendedQty: 2 });
  });

  it('breaks score ties by due date, then age, then number', () => {
    const fixture = snapshot(
      [
        order(3, 'MEDIUM', 5, [['x', 1]], '2026-10-20T12:00:00.000Z'),
        order(2, 'MEDIUM', 5, [['x', 1]], '2026-10-21T12:00:00.000Z'),
        order(1, 'MEDIUM', 5, [['x', 1]], '2026-10-21T12:00:00.000Z'),
      ],
      [lot('a', 'x', 100, 60)],
    );
    expect(ranked(buildProposal(fixture, balanced, fixedClock))).toEqual([3, 1, 2]);
  });

  it('summarizes full, partial and unserved orders and totals per unit', () => {
    const fixture = snapshot(
      [
        order(1, 'URGENT', 0, [['x', 4]]),
        order(2, 'HIGH', 1, [['x', 4]]),
        order(3, 'LOW', 9, [['x', 4]]),
      ],
      [lot('a', 'x', 6, 5)],
    );
    const { summary } = buildProposal(fixture, balanced, fixedClock);

    expect(summary).toMatchObject({
      strategy: 'BALANCED',
      ordersFull: 1,
      ordersPartial: 1,
      ordersUnserved: 1,
      totalRecommended: { KG: 6 },
      itemsProcessed: 3,
      linesCount: 3,
      processingMs: 0,
    });
  });

  it('is deterministic and does not depend on the order of the input', () => {
    const orders = [
      order(1, 'HIGH', 2, [['x', 3]]),
      order(2, 'MEDIUM', 1, [
        ['x', 3],
        ['y', 2],
      ]),
      order(3, 'URGENT', 6, [['y', 5]]),
    ];
    const lots = [lot('a', 'x', 4, 3), lot('b', 'x', 4, 8), lot('c', 'y', 6, 2)];
    const first = buildProposal(snapshot(orders, lots), balanced, fixedClock);
    const again = buildProposal(snapshot(orders, lots), balanced, fixedClock);
    const shuffled = buildProposal(
      snapshot([...orders].reverse(), [...lots].reverse(), ['x', 'y']),
      balanced,
      fixedClock,
    );

    expect(again).toEqual(first);
    expect(shuffled).toEqual(first);
  });

  it('never takes more than a lot has', () => {
    const fixture = snapshot(
      Array.from({ length: 20 }, (_, i) => order(i + 1, 'MEDIUM', i % 7, [['x', 1.5]])),
      [lot('a', 'x', 10, 5), lot('b', 'x', 7.25, 9)],
    );
    const { lines } = buildProposal(fixture, balanced, fixedClock);
    const byLot = (id: string) =>
      lines.filter((l) => l.lotId === id).reduce((s, l) => s + l.recommendedQty, 0);

    expect(byLot('a')).toBe(10);
    expect(byLot('b')).toBeCloseTo(7.25, 3);
  });

  it('handles an empty snapshot', () => {
    const result = buildProposal(snapshot([], []), balanced, fixedClock);
    expect(result.lines).toEqual([]);
    expect(result.summary).toMatchObject({
      ordersFull: 0,
      itemsProcessed: 0,
      totalRecommended: {},
    });
  });
});
