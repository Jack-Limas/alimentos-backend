import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Adds `Server-Timing: app;dur=<ms>` to every response (contract, section 3),
 * including error and 404 responses.
 */
const serverTimingPlugin: FastifyPluginCallback = (app, _options, done) => {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Server-Timing', `app;dur=${reply.elapsedTime.toFixed(1)}`);
    return payload;
  });

  done();
};

export default fp(serverTimingPlugin, { name: 'server-timing', fastify: '5.x' });
