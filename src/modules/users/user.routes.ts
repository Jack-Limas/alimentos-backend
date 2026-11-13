import type { FastifyPluginCallback } from 'fastify';
import type { UserController } from './user.controller.js';

export interface UserRoutesOptions {
  controller: UserController;
}

// Mounted under /api/v1/users. ADMIN only (contract, section 4.12). No public
// sign-up and no DELETE: users are deactivated with PATCH { active: false }.
export const userRoutes: FastifyPluginCallback<UserRoutesOptions> = (app, options, done) => {
  const { controller } = options;
  const adminOnly = { preHandler: [app.authenticate, app.authorize('ADMIN')] };

  app.get('/', adminOnly, controller.list);
  app.post('/', adminOnly, controller.create);
  app.patch('/:id', adminOnly, controller.update);
  app.post('/:id/reset-password', adminOnly, controller.resetPassword);

  done();
};
