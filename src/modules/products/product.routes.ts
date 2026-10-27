import type { FastifyPluginCallback } from 'fastify';
import type { ProductController } from './product.controller.js';

export interface ProductRoutesOptions {
  controller: ProductController;
}

// Mounted under /api/v1/products. Roles from the contract, section 4.3. No DELETE:
// products are deactivated with PATCH { status: "INACTIVE" }.
export const productRoutes: FastifyPluginCallback<ProductRoutesOptions> = (app, options, done) => {
  const { controller } = options;
  const anyRole = { preHandler: [app.authenticate, app.authorize('ADMIN', 'OPERATOR')] };
  const adminOnly = { preHandler: [app.authenticate, app.authorize('ADMIN')] };

  app.get('/', anyRole, controller.list);
  app.get('/:id', anyRole, controller.get);
  app.post('/', adminOnly, controller.create);
  app.patch('/:id', adminOnly, controller.update);

  done();
};
