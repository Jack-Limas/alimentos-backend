import type { FastifyRequest } from 'fastify';
import type { Paginated } from '../../shared/http/pagination.js';
import { auditLogQuerySchema } from './audit.schemas.js';
import type { AuditLogDto, AuditService } from './audit.service.js';

export interface AuditController {
  list: (request: FastifyRequest) => Promise<Paginated<AuditLogDto>>;
}

export function createAuditController(service: AuditService): AuditController {
  return {
    list: async (request) => {
      const { page, pageSize, action, userId, from, to } = auditLogQuerySchema.parse(request.query);
      return service.list(
        {
          action,
          userId,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        },
        { page, pageSize },
      );
    },
  };
}
