import type { FastifyPluginCallback } from 'fastify';
import type { AdminController } from './network-info.js';

export interface AdminRoutesOptions {
  controller: AdminController;
}

// Mounted under /api/v1/admin. ADMIN only.
export const adminRoutes: FastifyPluginCallback<AdminRoutesOptions> = (app, options, done) => {
  app.get(
    '/network-info',
    { preHandler: [app.authenticate, app.authorize('ADMIN')] },
    options.controller.networkInfo,
  );
  done();
};
