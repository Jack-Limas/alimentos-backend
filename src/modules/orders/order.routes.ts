import type { FastifyPluginCallback } from 'fastify';
import type { OrderController } from './order.controller.js';

export interface OrderRoutesOptions {
  controller: OrderController;
}

// Mounted under /api/v1/orders. Roles from the contract, section 4.6. The status
// route is open to both roles; the service applies the state machine, which
// lets only an ADMIN cancel.
export const orderRoutes: FastifyPluginCallback<OrderRoutesOptions> = (app, options, done) => {
  const { controller } = options;
  const anyRole = { preHandler: [app.authenticate, app.authorize('ADMIN', 'OPERATOR')] };
  const adminOnly = { preHandler: [app.authenticate, app.authorize('ADMIN')] };

  app.get('/', anyRole, controller.list);
  app.get('/:id', anyRole, controller.get);
  app.post('/', adminOnly, controller.create);
  app.patch('/:id/status', anyRole, controller.changeStatus);

  done();
};
