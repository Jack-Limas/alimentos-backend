import { describe, expect, it } from 'vitest';
import {
  fromMilli,
  hasAtMostThreeDecimals,
  roundQty,
  sumQty,
  toMilli,
} from '../src/modules/inventory/domain/quantity.js';

describe('quantity arithmetic', () => {
  it('adds without floating point drift', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumQty([0.1, 0.2])).toBe(0.3);
    expect(sumQty([1.005, 2.105, 0.89])).toBe(4);
  });

  it('round-trips through milli units', () => {
    expect(toMilli(12.345)).toBe(12345);
    expect(fromMilli(12345)).toBe(12.345);
    expect(roundQty(1.23449)).toBe(1.234);
    expect(toMilli(999_999_999.999)).toBe(999_999_999_999);
  });

  it('detects values with more than 3 decimals', () => {
    expect(hasAtMostThreeDecimals(1.5)).toBe(true);
    expect(hasAtMostThreeDecimals(0.125)).toBe(true);
    expect(hasAtMostThreeDecimals(2.001)).toBe(true);
    expect(hasAtMostThreeDecimals(1.0005)).toBe(false);
  });
});
