import type { FastifyPluginCallback } from 'fastify';
import type { HealthController } from './health.controller.js';

export interface HealthRoutesOptions {
  controller: HealthController;
  /** Registers GET /health/ready as well (only under /api/v1). */
  includeReadiness: boolean;
}

const livenessSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        service: { type: 'string' },
        version: { type: 'string' },
        uptimeSec: { type: 'integer' },
      },
      required: ['status', 'service', 'version', 'uptimeSec'],
    },
  },
} as const;

const readinessBody = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    db: { type: 'string' },
  },
  required: ['status', 'db'],
} as const;

const readinessSchema = {
  response: { 200: readinessBody, 503: readinessBody },
} as const;

export const healthRoutes: FastifyPluginCallback<HealthRoutesOptions> = (app, options, done) => {
  const { controller } = options;

  app.get('/health', { schema: livenessSchema }, controller.liveness);

  if (options.includeReadiness) {
    app.get('/health/ready', { schema: readinessSchema }, controller.readiness);
  }

  done();
};
