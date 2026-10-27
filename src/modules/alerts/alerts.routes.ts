import type { FastifyPluginCallback } from 'fastify';
import type { AlertsController } from './alerts.controller.js';

export interface AlertsRoutesOptions {
  controller: AlertsController;
}

// Mounted under /api/v1/alerts (contract, section 4.8). Computed on every
// request, never stored.
export const alertsRoutes: FastifyPluginCallback<AlertsRoutesOptions> = (app, options, done) => {
  const anyRole = { preHandler: [app.authenticate, app.authorize('ADMIN', 'OPERATOR')] };

  app.get('/', anyRole, options.controller.list);

  done();
};
