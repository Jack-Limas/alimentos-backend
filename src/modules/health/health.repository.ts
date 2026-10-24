import type { PrismaClient } from '@prisma/client';

/** Resolves when the database answers, rejects otherwise. */
export type DatabaseCheck = () => Promise<void>;

export function createPrismaDatabaseCheck(prisma: PrismaClient): DatabaseCheck {
  return async () => {
    await prisma.$queryRaw`SELECT 1`;
  };
}
