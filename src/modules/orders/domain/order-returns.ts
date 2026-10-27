import { fromMilli, toMilli } from '../../inventory/domain/index.js';

/** A stock movement of an order, as read from inventory_movements. */
export interface OrderMovement {
  lotId: string;
  type: 'ENTRY' | 'EXIT_DISPATCH' | 'EXIT_WASTE' | 'ADJUSTMENT' | 'RETURN';
  quantity: number;
}

export interface LotReturn {
  lotId: string;
  qty: number;
}

/**
 * What a cancellation must give back to each lot: everything the order
 * dispatched from it minus what was already returned. Lots with nothing left
 * to return are omitted. Sorted by lot id so the result is deterministic.
 */
export function returnsForCancellation(movements: readonly OrderMovement[]): LotReturn[] {
  const netMilli = new Map<string, number>();
  for (const { lotId, type, quantity } of movements) {
    const sign = type === 'EXIT_DISPATCH' ? 1 : type === 'RETURN' ? -1 : 0;
    if (sign === 0) continue;
    netMilli.set(lotId, (netMilli.get(lotId) ?? 0) + sign * toMilli(quantity));
  }
  return [...netMilli]
    .filter(([, milli]) => milli > 0)
    .map(([lotId, milli]) => ({ lotId, qty: fromMilli(milli) }))
    .sort((a, b) => (a.lotId < b.lotId ? -1 : 1));
}
