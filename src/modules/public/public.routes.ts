import type { FastifyPluginCallback } from 'fastify';
import { AppError } from '../../shared/errors/index.js';
import type { RateLimiter } from '../../shared/http/rate-limiter.js';
import type { ImpactService } from './impact.service.js';

export interface PublicRoutesOptions {
  impact: ImpactService;
  limiter: RateLimiter;
}

/** Browsers and the frontend's ISR may cache the page for 5 minutes. */
export const IMPACT_CACHE_CONTROL = 'public, max-age=300';

// Mounted under /api/v1/public (contract 4.11): no authentication, aggregates only.
export const publicRoutes: FastifyPluginCallback<PublicRoutesOptions> = (app, options, done) => {
  app.get('/impact', async (request, reply) => {
    // Per IP (request.ip honours X-Forwarded-For behind Render's proxy).
    const limit = options.limiter.hit(request.ip);
    if (!limit.allowed) {
      throw new AppError(
        429,
        'TOO_MANY_REQUESTS',
        'Too many requests, try again later',
        { retryAfterSec: limit.retryAfterSec },
        { 'Retry-After': String(limit.retryAfterSec) },
      );
    }
    const data = await options.impact.impact();
    void reply.header('Cache-Control', IMPACT_CACHE_CONTROL);
    return { data };
  });
  done();
};
