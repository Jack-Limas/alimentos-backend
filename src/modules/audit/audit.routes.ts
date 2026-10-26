import type { FastifyPluginCallback } from 'fastify';
import type { AuditController } from './audit.controller.js';

export interface AuditRoutesOptions {
  controller: AuditController;
}

export const auditRoutes: FastifyPluginCallback<AuditRoutesOptions> = (app, options, done) => {
  app.get(
    '/audit-logs',
    { preHandler: [app.authenticate, app.authorize('ADMIN')] },
    options.controller.list,
  );
  done();
};
