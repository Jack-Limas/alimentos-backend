import { describe, expect, it } from 'vitest';
import { allocateFefo, isExpired, type FefoLot } from '../src/modules/inventory/domain/fefo.js';

const today = '2026-10-26';

const lots: FefoLot[] = [
  { id: 'late', quantity: 50, expiryDate: '2026-12-01' },
  { id: 'soon', quantity: 10, expiryDate: '2026-10-28' },
  { id: 'expired', quantity: 8, expiryDate: '2026-10-25' },
  { id: 'mid', quantity: 20, expiryDate: '2026-11-10' },
];

describe('allocateFefo', () => {
  it('covers the full quantity from the earliest expiring lots first', () => {
    expect(allocateFefo(lots, 25, { today })).toEqual({
      allocations: [
        { lotId: 'soon', qty: 10 },
        { lotId: 'mid', qty: 15 },
      ],
      allocatedQty: 25,
      shortfall: 0,
    });
  });

  it('takes from a single lot when it is enough', () => {
    expect(allocateFefo(lots, 4, { today }).allocations).toEqual([{ lotId: 'soon', qty: 4 }]);
  });

  it('reports the shortfall when the stock is not enough (partial)', () => {
    const result = allocateFefo(lots, 100, { today });

    expect(result.allocations).toEqual([
      { lotId: 'soon', qty: 10 },
      { lotId: 'mid', qty: 20 },
      { lotId: 'late', qty: 50 },
    ]);
    expect(result.allocatedQty).toBe(80);
    expect(result.shortfall).toBe(20);
  });

  it('ignores expired lots by default', () => {
    const result = allocateFefo(lots, 5, { today });

    expect(result.allocations.map((a) => a.lotId)).not.toContain('expired');
  });

  it('uses expired lots first when includeExpired is true (writing off waste)', () => {
    expect(allocateFefo(lots, 12, { today, includeExpired: true }).allocations).toEqual([
      { lotId: 'expired', qty: 8 },
      { lotId: 'soon', qty: 4 },
    ]);
  });

  it('treats a lot expiring today as usable', () => {
    const result = allocateFefo([{ id: 'today', quantity: 3, expiryDate: today }], 2, { today });

    expect(result.allocations).toEqual([{ lotId: 'today', qty: 2 }]);
  });

  it('skips lots with zero stock and returns everything as shortfall when there is none', () => {
    const empty: FefoLot[] = [
      { id: 'a', quantity: 0, expiryDate: '2026-11-01' },
      { id: 'b', quantity: 0, expiryDate: '2026-11-02' },
    ];

    expect(allocateFefo(empty, 5, { today })).toEqual({
      allocations: [],
      allocatedQty: 0,
      shortfall: 5,
    });
    expect(allocateFefo([], 5, { today }).shortfall).toBe(5);
  });

  it('only has expired stock: nothing without includeExpired, all of it with it', () => {
    const onlyExpired: FefoLot[] = [{ id: 'old', quantity: 6, expiryDate: '2026-10-01' }];

    expect(allocateFefo(onlyExpired, 6, { today }).shortfall).toBe(6);
    expect(allocateFefo(onlyExpired, 6, { today, includeExpired: true }).shortfall).toBe(0);
  });

  it('breaks ties on the same expiry by reception date, then by id', () => {
    const tied: FefoLot[] = [
      { id: 'b', quantity: 1, expiryDate: '2026-11-01', receivedAt: new Date('2026-10-02') },
      { id: 'c', quantity: 1, expiryDate: '2026-11-01', receivedAt: new Date('2026-10-01') },
      { id: 'a', quantity: 1, expiryDate: '2026-11-01', receivedAt: new Date('2026-10-02') },
    ];

    expect(allocateFefo(tied, 3, { today }).allocations.map((a) => a.lotId)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('keeps 3-decimal precision without float drift', () => {
    const fractional: FefoLot[] = [
      { id: 'x', quantity: 0.1, expiryDate: '2026-11-01' },
      { id: 'y', quantity: 0.2, expiryDate: '2026-11-02' },
    ];

    const result = allocateFefo(fractional, 0.3, { today });

    expect(result.allocatedQty).toBe(0.3);
    expect(result.shortfall).toBe(0);
    expect(allocateFefo(fractional, 0.25, { today }).allocations).toEqual([
      { lotId: 'x', qty: 0.1 },
      { lotId: 'y', qty: 0.15 },
    ]);
  });

  it('does not modify the input lots', () => {
    const copy = structuredClone(lots);

    allocateFefo(lots, 30, { today });

    expect(lots).toEqual(copy);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects a quantity of %s', (qty) => {
    expect(() => allocateFefo(lots, qty, { today })).toThrow(RangeError);
  });
});

describe('isExpired', () => {
  it('is false on the expiry date and true from the next day', () => {
    expect(isExpired('2026-10-26', today)).toBe(false);
    expect(isExpired('2026-10-25', today)).toBe(true);
  });
});
