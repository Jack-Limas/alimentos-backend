import type { FastifyPluginCallback } from 'fastify';
import type { DistributionController } from './distribution.controller.js';

export interface DistributionRoutesOptions {
  controller: DistributionController;
}

// Mounted under /api/v1/distribution. Both roles (contract, section 4.7): the
// operator plans the warehouse day too. The server always recomputes the plan.
export const distributionRoutes: FastifyPluginCallback<DistributionRoutesOptions> = (
  app,
  options,
  done,
) => {
  const { controller } = options;
  const anyRole = { preHandler: [app.authenticate, app.authorize('ADMIN', 'OPERATOR')] };

  app.get('/snapshot', anyRole, controller.snapshot);
  app.post('/proposals', anyRole, controller.createProposal);
  app.get('/proposals', anyRole, controller.list);
  app.get('/proposals/:id', anyRole, controller.get);
  app.post('/proposals/:id/confirm', anyRole, controller.confirm);
  app.post('/proposals/:id/discard', anyRole, controller.discard);

  done();
};
