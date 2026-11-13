import type { Role } from '@prisma/client';
import type { Clock } from '../../shared/clock.js';
import type { UserRepository } from '../users/user.repository.js';

/** What every authenticated request checks besides the token's signature. */
export interface SessionStatus {
  active: boolean;
  role: Role;
  mustChangePassword: boolean;
}

export interface SessionStatusLookup {
  /** The user's current status, or null when the user no longer exists. */
  get(userId: string): Promise<SessionStatus | null>;
  /** Drops the cached status after a change, so it applies to the next request. */
  forget(userId: string): void;
}

/** Long enough to absorb the burst of requests of one page, short enough to not matter. */
export const SESSION_STATUS_TTL_MS = 5_000;

/**
 * The access token is a stateless JWT: on its own it would keep working until
 * it expires after the user is deactivated or changes role. This lookup lets
 * `authenticate` check the user on every request (one primary-key read, cached
 * for a few seconds; writes from this process `forget` it at once).
 */
export function createSessionStatusLookup(
  users: Pick<UserRepository, 'findById'>,
  clock: Clock,
  ttlMs = SESSION_STATUS_TTL_MS,
): SessionStatusLookup {
  const cache = new Map<string, { status: SessionStatus | null; until: number }>();
  return {
    async get(userId) {
      const now = clock().getTime();
      const hit = cache.get(userId);
      if (hit && hit.until > now) return hit.status;
      const user = await users.findById(userId);
      const status = user
        ? { active: user.active, role: user.role, mustChangePassword: user.mustChangePassword }
        : null;
      // Bounded: drop everything rather than grow without limit.
      if (cache.size > 1_000) cache.clear();
      cache.set(userId, { status, until: now + ttlMs });
      return status;
    },
    forget(userId) {
      cache.delete(userId);
    },
  };
}
