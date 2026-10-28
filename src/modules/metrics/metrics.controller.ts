import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiMetricsReport, MetricsService } from './metrics.service.js';
import { webVitalSchema, type WebVitalsReport } from './web-vitals.js';

export interface MetricsController {
  api: () => { data: ApiMetricsReport };
  addWebVital: (request: FastifyRequest, reply: FastifyReply) => FastifyReply;
  webVitals: () => { data: WebVitalsReport };
}

export function createMetricsController(service: MetricsService): MetricsController {
  return {
    api: () => ({ data: service.api() }),
    addWebVital: (request, reply) => {
      service.addWebVital(webVitalSchema.parse(request.body));
      return reply.status(204).send();
    },
    webVitals: () => ({ data: service.webVitals() }),
  };
}
