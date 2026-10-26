import { Prisma, type PrismaClient } from '@prisma/client';
import type { AuditLogFilter, AuditLogRepository } from './audit-log.repository.js';

function toWhere(filter: AuditLogFilter): Prisma.AuditLogWhereInput {
  return {
    ...(filter.action ? { action: filter.action } : {}),
    ...(filter.userId ? { userId: filter.userId } : {}),
    ...(filter.from || filter.to
      ? {
          createdAt: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          },
        }
      : {}),
  };
}

export function createPrismaAuditLogRepository(prisma: PrismaClient): AuditLogRepository {
  return {
    async create(entry) {
      await prisma.auditLog.create({
        data: { ...entry, metadata: entry.metadata ?? Prisma.DbNull },
      });
    },

    async list(filter, page) {
      const where = toWhere(filter);
      const [items, total] = await prisma.$transaction([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: page.skip,
          take: page.take,
        }),
        prisma.auditLog.count({ where }),
      ]);
      return { items, total };
    },
  };
}
