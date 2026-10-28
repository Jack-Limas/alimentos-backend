import type { FastifyPluginCallback, preHandlerHookHandler } from 'fastify';
import { actorOf } from '../../shared/http/actor.js';
import { AppError } from '../../shared/errors/index.js';
import type { AiController } from './ai.controller.js';
import type { RateLimiter } from './ai-rate-limit.js';

export interface AiRoutesOptions {
  controller: AiController;
  limiter: RateLimiter;
}

// Mounted under /api/v1/ai (contract 4.9). The rate limit runs after
// `authorize`, so a refused role does not use up the user's calls.
export const aiRoutes: FastifyPluginCallback<AiRoutesOptions> = (app, options, done) => {
  const { controller, limiter } = options;

  const rateLimit: preHandlerHookHandler = (request, _reply, next) => {
    const result = limiter.hit(actorOf(request).userId);
    if (!result.allowed) {
      next(
        new AppError(
          429,
          'TOO_MANY_REQUESTS',
          'Too many AI requests, try again later',
          { retryAfterSec: result.retryAfterSec },
          { 'Retry-After': String(result.retryAfterSec) },
        ),
      );
      return;
    }
    next();
  };
  const anyRole = { preHandler: [app.authenticate, app.authorize('ADMIN', 'OPERATOR'), rateLimit] };
  const adminOnly = { preHandler: [app.authenticate, app.authorize('ADMIN'), rateLimit] };

  app.post('/proposals/:id/explanation', anyRole, controller.explainProposal);
  app.post('/rescue-plan', adminOnly, controller.rescuePlan);
  app.post('/briefing', anyRole, controller.briefing);

  done();
};
