import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import type { DemoRefreshService } from '../modules/demo/index.js';

export interface DemoRefreshPluginOptions {
  service: DemoRefreshService;
  /** Route patterns that wake the daily refresh: a successful login and the public impact page. */
  triggers: { method: string; url: string; trigger: 'login' | 'public-impact' }[];
}

/**
 * Lazy daily demo refresh (DEMO_DAILY_REFRESH=true), without a cron: after a
 * successful login or GET /public/impact has been ANSWERED (onResponse runs
 * once the reply is sent), the service checks whether today's refresh is due.
 * The request never waits for it and never fails because of it. Health checks
 * never trigger it (Render pings them all the time).
 */
const demoRefreshPlugin: FastifyPluginCallback<DemoRefreshPluginOptions> = (app, options, done) => {
  app.addHook('onResponse', (request, reply, hookDone) => {
    if (reply.statusCode === 200) {
      const route = request.routeOptions.url;
      const match = options.triggers.find(
        (candidate) => candidate.method === request.method && candidate.url === route,
      );
      if (match) options.service.refreshIfDue(match.trigger);
    }
    hookDone();
  });
  done();
};

export default fp(demoRefreshPlugin, { name: 'demo-refresh', fastify: '5.x' });
