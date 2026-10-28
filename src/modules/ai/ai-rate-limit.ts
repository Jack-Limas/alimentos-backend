/** Calls to /ai/* per user and window (contract 4.9), kept in memory. */
export const AI_RATE_LIMIT = { max: 10, windowMs: 60_000 } as const;

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSec: number };

export interface RateLimiter {
  hit(key: string): RateLimitResult;
}

/**
 * Sliding window: a key may make `max` calls in any `windowMs`. A refused
 * call does not count. In memory, so it resets on restart and is per instance
 * (one Render instance in this project).
 */
export function createRateLimiter({
  max = AI_RATE_LIMIT.max,
  windowMs = AI_RATE_LIMIT.windowMs,
  now = Date.now,
}: { max?: number; windowMs?: number; now?: () => number } = {}): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    hit(key) {
      const current = now();
      const recent = (hits.get(key) ?? []).filter((time) => current - time < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        const oldest = recent[0] ?? current;
        return {
          allowed: false,
          retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - current) / 1000)),
        };
      }
      recent.push(current);
      hits.set(key, recent);
      return { allowed: true };
    },
  };
}
