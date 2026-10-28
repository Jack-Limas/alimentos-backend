import { describe, expect, it } from 'vitest';
import { findTieGroups, TIE_SCORE_DELTA } from '../src/modules/distribution/domain/index.js';

const entries = (...scores: [string, number][]) => scores.map(([key, score]) => ({ key, score }));

describe('findTieGroups', () => {
  it('groups scores closer than the tie delta, best first', () => {
    expect(TIE_SCORE_DELTA).toBe(2);
    expect(findTieGroups(entries(['c', 70], ['a', 90], ['b', 88.5], ['d', 69]))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('chains neighbours: each one is compared with the previous score', () => {
    expect(findTieGroups(entries(['a', 50], ['b', 48.5], ['c', 47]))).toEqual([['a', 'b', 'c']]);
  });

  it('does not tie a difference of exactly 2 and ignores single orders', () => {
    expect(findTieGroups(entries(['a', 50], ['b', 48], ['c', 30]))).toEqual([]);
  });

  it('keeps the input order for equal scores', () => {
    expect(findTieGroups(entries(['z', 40], ['y', 40]))).toEqual([['z', 'y']]);
  });
});
