import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import type { ApiMetrics } from '../modules/metrics/api-metrics.js';

export interface ApiMetricsPluginOptions {
  metrics: ApiMetrics;
}

/**
 * Records every response time by route pattern ("GET /api/v1/orders/:id"),
 * so IDs never create one bucket per URL. Unknown URLs share one bucket.
 */
const apiMetricsPlugin: FastifyPluginCallback<ApiMetricsPluginOptions> = (app, options, done) => {
  app.addHook('onResponse', async (request, reply) => {
    const pattern = request.routeOptions.url ?? '(unmatched)';
    options.metrics.record(`${request.method} ${pattern}`, reply.elapsedTime, reply.statusCode);
  });
  done();
};

export default fp(apiMetricsPlugin, { name: 'api-metrics', fastify: '5.x' });
