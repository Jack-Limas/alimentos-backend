import type { FastifyPluginCallback } from 'fastify';
import type { AuthController } from './auth.controller.js';

export interface AuthRoutesOptions {
  controller: AuthController;
}

// Mounted under /api/v1/auth, the same path the refresh cookie is scoped to.
export const authRoutes: FastifyPluginCallback<AuthRoutesOptions> = (app, options, done) => {
  const { controller } = options;

  app.post('/login', controller.login);
  app.post('/refresh', controller.refresh);
  app.post('/logout', controller.logout);
  app.get('/me', { preHandler: app.authenticate }, controller.me);
  // Bearer for who; the refresh cookie (same path) tells which session to keep.
  app.post('/change-password', { preHandler: app.authenticate }, controller.changePassword);

  done();
};
