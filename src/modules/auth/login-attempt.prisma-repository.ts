import type { PrismaClient } from '@prisma/client';
import type { LoginAttemptRepository } from './login-attempt.repository.js';

export function createPrismaLoginAttemptRepository(prisma: PrismaClient): LoginAttemptRepository {
  return {
    async record(attempt) {
      await prisma.loginAttempt.create({ data: attempt });
    },

    async failuresSince(email, ip, since) {
      // Served by the (email, ip, createdAt) index.
      const rows = await prisma.loginAttempt.findMany({
        where: { email, ip, success: false, createdAt: { gte: since } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((row) => row.createdAt);
    },

    async lastSuccessAt(email, ip) {
      const row = await prisma.loginAttempt.findFirst({
        where: { email, ip, success: true },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      return row?.createdAt ?? null;
    },
  };
}
