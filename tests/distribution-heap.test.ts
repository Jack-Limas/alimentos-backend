import { describe, expect, it } from 'vitest';
import { MinHeap } from '../src/modules/distribution/domain/min-heap.js';
import { createRandom } from '../src/seed/random.js';

const numbers = () => new MinHeap<number>((a, b) => a - b);

function drain<T>(heap: MinHeap<T>): T[] {
  const out: T[] = [];
  while (!heap.isEmpty()) out.push(heap.pop() as T);
  return out;
}

describe('MinHeap', () => {
  it('is empty at first: pop and peek give undefined', () => {
    const heap = numbers();
    expect(heap.size).toBe(0);
    expect(heap.isEmpty()).toBe(true);
    expect(heap.peek()).toBeUndefined();
    expect(heap.pop()).toBeUndefined();
  });

  it('gives items in comparator order and peek does not remove', () => {
    const heap = numbers();
    for (const n of [5, 1, 4, 1, 3, 9, 2]) heap.push(n);
    expect(heap.peek()).toBe(1);
    expect(heap.size).toBe(7);
    expect(drain(heap)).toEqual([1, 1, 2, 3, 4, 5, 9]);
  });

  it('handles a single element and pushes after pops', () => {
    const heap = numbers();
    heap.push(7);
    expect(heap.pop()).toBe(7);
    heap.push(3);
    heap.push(8);
    expect(heap.pop()).toBe(3);
    heap.push(1);
    expect(drain(heap)).toEqual([1, 8]);
  });

  it('works as a max-heap with a reversed comparator', () => {
    const heap = new MinHeap<number>((a, b) => b - a);
    for (const n of [2, 9, 4]) heap.push(n);
    expect(drain(heap)).toEqual([9, 4, 2]);
  });

  it('matches a sort for 10 000 pseudo-random elements', () => {
    const random = createRandom(42);
    const values = Array.from({ length: 10_000 }, () => random.int(-1_000_000, 1_000_000));
    const heap = numbers();
    for (const value of values) heap.push(value);
    expect(drain(heap)).toEqual([...values].sort((a, b) => a - b));
  });

  it('keeps ties in the order the comparator defines', () => {
    const heap = new MinHeap<{ score: number; id: string }>(
      (a, b) => b.score - a.score || (a.id < b.id ? -1 : 1),
    );
    for (const id of ['c', 'a', 'b']) heap.push({ score: 10, id });
    heap.push({ score: 50, id: 'z' });
    expect(drain(heap).map((x) => x.id)).toEqual(['z', 'a', 'b', 'c']);
  });
});
