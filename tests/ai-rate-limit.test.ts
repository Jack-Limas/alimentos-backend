import { describe, expect, it } from 'vitest';
import { AI_RATE_LIMIT, createRateLimiter } from '../src/modules/ai/ai-rate-limit.js';

describe('createRateLimiter', () => {
  it('allows 10 calls per minute and user, then answers with the seconds to wait', () => {
    let now = 0;
    const limiter = createRateLimiter({ now: () => now });
    expect(AI_RATE_LIMIT).toEqual({ max: 10, windowMs: 60_000 });

    for (let i = 0; i < 10; i += 1) {
      expect(limiter.hit('admin')).toEqual({ allowed: true });
      now += 1_000;
    }
    expect(limiter.hit('admin')).toEqual({ allowed: false, retryAfterSec: 50 });
    expect(limiter.hit('operator')).toEqual({ allowed: true });
  });

  it('frees a slot as the window slides and does not count refused calls', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 10_000, now: () => now });
    limiter.hit('u');
    now = 4_000;
    limiter.hit('u');
    now = 9_000;
    expect(limiter.hit('u')).toEqual({ allowed: false, retryAfterSec: 1 });
    now = 10_000;
    expect(limiter.hit('u')).toEqual({ allowed: true });
    expect(limiter.hit('u')).toEqual({ allowed: false, retryAfterSec: 4 });
  });
});
