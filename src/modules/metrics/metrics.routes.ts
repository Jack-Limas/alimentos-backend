import type { FastifyPluginCallback } from 'fastify';
import type { MetricsController } from './metrics.controller.js';

export interface MetricsRoutesOptions {
  controller: MetricsController;
}

// Mounted under /api/v1/metrics (contract 4.10). Reading is ADMIN only; both
// roles send the web vitals of the pages they use.
export const metricsRoutes: FastifyPluginCallback<MetricsRoutesOptions> = (app, options, done) => {
  const { controller } = options;
  const adminOnly = { preHandler: [app.authenticate, app.authorize('ADMIN')] };
  const anyRole = { preHandler: [app.authenticate, app.authorize('ADMIN', 'OPERATOR')] };

  app.get('/api', adminOnly, controller.api);
  app.post('/web-vitals', anyRole, controller.addWebVital);
  app.get('/web-vitals', adminOnly, controller.webVitals);

  done();
};
