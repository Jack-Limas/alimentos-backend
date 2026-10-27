import { describe, expect, it } from 'vitest';
import { createRandom } from '../src/seed/random.js';

describe('createRandom', () => {
  it('repeats the same sequence for the same seed and differs for another', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const c = createRandom(43);
    const seqA = Array.from({ length: 5 }, () => a.next());

    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
  });

  it('stays inside the requested ranges', () => {
    const random = createRandom(7);
    for (let index = 0; index < 1000; index += 1) {
      const value = random.between(2, 3);
      const whole = random.int(1, 3);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThan(3);
      expect([1, 2, 3]).toContain(whole);
    }
  });
});
