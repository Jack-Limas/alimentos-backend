import type { FastifyReply, FastifyRequest } from 'fastify';
import { actorOf } from '../../shared/http/actor.js';
import { reportKindParamsSchema, reportQuerySchema } from './reports.schemas.js';
import type { ReportsService } from './reports.service.js';

export interface ReportsController {
  download: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
}

/** RFC 6266: an ASCII fallback plus the UTF-8 name (our names are ASCII anyway). */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createReportsController(service: ReportsService): ReportsController {
  return {
    download: async (request, reply) => {
      const { kind } = reportKindParamsSchema.parse(request.params);
      const query = reportQuerySchema.parse(request.query);
      const report = await service.generate(kind, query, actorOf(request));
      return (
        reply
          .header('Content-Type', report.contentType)
          .header('Content-Disposition', contentDisposition(report.filename))
          .header('Cache-Control', 'no-store')
          .header('X-Generation-Time-Ms', String(report.timings.totalMs))
          // The server-timing plugin appends app;dur to these.
          .header(
            'Server-Timing',
            `db;dur=${String(report.timings.readMs)}, render;dur=${String(report.timings.renderMs)}`,
          )
          .send(report.body)
      );
    },
  };
}
