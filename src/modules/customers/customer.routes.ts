import type { FastifyPluginCallback } from 'fastify';
import type { CustomerController } from './customer.controller.js';

export interface CustomerRoutesOptions {
  controller: CustomerController;
}

// Mounted under /api/v1/customers. ADMIN only (contract, section 4.5). No DELETE:
// customers are deactivated with PATCH { status: "INACTIVE" }.
export const customerRoutes: FastifyPluginCallback<CustomerRoutesOptions> = (
  app,
  options,
  done,
) => {
  const { controller } = options;
  const adminOnly = { preHandler: [app.authenticate, app.authorize('ADMIN')] };

  app.get('/', adminOnly, controller.list);
  app.get('/:id', adminOnly, controller.get);
  app.post('/', adminOnly, controller.create);
  app.patch('/:id', adminOnly, controller.update);

  done();
};
