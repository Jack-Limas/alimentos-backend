import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';

export const auditLogQuerySchema = paginationQuerySchema
  .extend({
    action: z.string().trim().min(1).max(64).optional(),
    userId: z.uuid().optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((query) => !query.from || !query.to || new Date(query.from) <= new Date(query.to), {
    message: '`from` must be before `to`',
    path: ['from'],
  });

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
