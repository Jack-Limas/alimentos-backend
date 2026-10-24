import type { FastifyReply, FastifyRequest } from 'fastify';
import type { HealthService, LivenessStatus, ReadinessStatus } from './health.service.js';

export interface HealthController {
  liveness: (request: FastifyRequest, reply: FastifyReply) => LivenessStatus;
  readiness: (request: FastifyRequest, reply: FastifyReply) => Promise<ReadinessStatus>;
}

export function createHealthController(service: HealthService): HealthController {
  return {
    liveness: () => service.getLiveness(),

    readiness: async (_request, reply) => {
      const result = await service.getReadiness();
      reply.status(result.status === 'ok' ? 200 : 503);
      return result;
    },
  };
}
