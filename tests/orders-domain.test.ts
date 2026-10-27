import { describe, expect, it } from 'vitest';
import { formatOrderCode, returnsForCancellation } from '../src/modules/orders/domain/index.js';

describe('formatOrderCode', () => {
  it('pads the number to six digits', () => {
    expect(formatOrderCode(1)).toBe('PED-000001');
    expect(formatOrderCode(123)).toBe('PED-000123');
    expect(formatOrderCode(1234567)).toBe('PED-1234567');
  });
});

describe('returnsForCancellation', () => {
  it('returns everything dispatched to each lot, summed exactly', () => {
    expect(
      returnsForCancellation([
        { lotId: 'b', type: 'EXIT_DISPATCH', quantity: 0.1 },
        { lotId: 'b', type: 'EXIT_DISPATCH', quantity: 0.2 },
        { lotId: 'a', type: 'EXIT_DISPATCH', quantity: 5 },
      ]),
    ).toEqual([
      { lotId: 'a', qty: 5 },
      { lotId: 'b', qty: 0.3 },
    ]);
  });

  it('subtracts what was already returned and omits fully returned lots', () => {
    expect(
      returnsForCancellation([
        { lotId: 'a', type: 'EXIT_DISPATCH', quantity: 5 },
        { lotId: 'a', type: 'RETURN', quantity: 2 },
        { lotId: 'b', type: 'EXIT_DISPATCH', quantity: 1 },
        { lotId: 'b', type: 'RETURN', quantity: 1 },
      ]),
    ).toEqual([{ lotId: 'a', qty: 3 }]);
  });

  it('ignores other movement types and returns nothing without dispatches', () => {
    expect(
      returnsForCancellation([
        { lotId: 'a', type: 'EXIT_WASTE', quantity: 4 },
        { lotId: 'a', type: 'ENTRY', quantity: 9 },
      ]),
    ).toEqual([]);
    expect(returnsForCancellation([])).toEqual([]);
  });
});
