import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Adds `Server-Timing: app;dur=<ms>` to every response (contract, section 3),
 * including error and 404 responses. A handler may set its own metrics first
 * (e.g. `db;dur=…, render;dur=…` on reports): app;dur is appended to them.
 */
const serverTimingPlugin: FastifyPluginCallback = (app, _options, done) => {
  app.addHook('onSend', async (_request, reply, payload) => {
    const own = reply.getHeader('Server-Timing');
    const app = `app;dur=${reply.elapsedTime.toFixed(1)}`;
    reply.header('Server-Timing', typeof own === 'string' && own ? `${own}, ${app}` : app);
    return payload;
  });

  done();
};

export default fp(serverTimingPlugin, { name: 'server-timing', fastify: '5.x' });
