import { describe, expect, it } from 'vitest';
import { percentile, RingBuffer, summarize } from '../src/modules/metrics/domain/index.js';

describe('RingBuffer', () => {
  it('keeps the last `capacity` values, oldest first', () => {
    const buffer = new RingBuffer<number>(3);
    [1, 2].forEach((v) => {
      buffer.push(v);
    });
    expect(buffer.values()).toEqual([1, 2]);
    [3, 4, 5].forEach((v) => {
      buffer.push(v);
    });
    expect(buffer.values()).toEqual([3, 4, 5]);
    buffer.push(6);
    expect(buffer.values()).toEqual([4, 5, 6]);
    expect(buffer.size).toBe(3);
  });

  it('never grows past its capacity', () => {
    const buffer = new RingBuffer<number>(500);
    for (let i = 0; i < 10_000; i += 1) buffer.push(i);
    expect(buffer.size).toBe(500);
    expect(buffer.values()[0]).toBe(9_500);
  });

  it('rejects a capacity that is not a positive integer', () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
  });
});

describe('percentiles', () => {
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);

  it('uses the nearest rank (always a measured value)', () => {
    expect(percentile(hundred, 50)).toBe(50);
    expect(percentile(hundred, 95)).toBe(95);
    expect(percentile(hundred, 99)).toBe(99);
    expect(percentile([10, 20, 30, 40], 75)).toBe(30);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });

  it('does not depend on the input order', () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
  });

  it('summarizes p50, p75, p95 and p99 with 2 decimals', () => {
    expect(summarize([...hundred].reverse())).toEqual({
      count: 100,
      p50: 50,
      p75: 75,
      p95: 95,
      p99: 99,
    });
    expect(summarize([1.23456])).toEqual({ count: 1, p50: 1.23, p75: 1.23, p95: 1.23, p99: 1.23 });
    expect(summarize([])).toEqual({ count: 0, p50: null, p75: null, p95: null, p99: null });
  });
});
