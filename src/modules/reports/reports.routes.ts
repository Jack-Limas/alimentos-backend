import type { FastifyPluginCallback } from 'fastify';
import type { ReportsController } from './reports.controller.js';

export interface ReportsRoutesOptions {
  controller: ReportsController;
}

// Mounted under /api/v1/reports (contract 4.10): ADMIN only.
// GET /inventory, /orders?from&to and /waste?from&to, with ?format=csv|pdf&locale=es|en.
export const reportsRoutes: FastifyPluginCallback<ReportsRoutesOptions> = (app, options, done) => {
  app.get(
    '/:kind',
    { preHandler: [app.authenticate, app.authorize('ADMIN')] },
    options.controller.download,
  );
  done();
};
