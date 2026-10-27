import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/index.js';

/** Who performs a write, for movements and audit rows. */
export interface Actor {
  userId: string;
  ip: string;
}

/** Reads the actor from a request already checked by `app.authenticate`. */
export function actorOf(request: FastifyRequest): Actor {
  const userId = (request.user as { sub?: unknown } | undefined)?.sub;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  }
  return { userId, ip: request.ip };
}
