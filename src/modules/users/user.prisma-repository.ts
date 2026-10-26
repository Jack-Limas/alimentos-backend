import type { PrismaClient } from '@prisma/client';
import type { UserRecord, UserRepository } from './user.repository.js';

const userSelect = {
  id: true,
  email: true,
  name: true,
  passwordHash: true,
  role: true,
  active: true,
} as const;

export function createPrismaUserRepository(prisma: PrismaClient): UserRepository {
  return {
    findByEmail: (email): Promise<UserRecord | null> =>
      prisma.user.findUnique({ where: { email }, select: userSelect }),

    findById: (id): Promise<UserRecord | null> =>
      prisma.user.findUnique({ where: { id }, select: userSelect }),

    upsertByEmail: (input): Promise<UserRecord> =>
      prisma.user.upsert({
        where: { email: input.email },
        create: { ...input, active: true },
        update: { name: input.name, passwordHash: input.passwordHash, role: input.role },
        select: userSelect,
      }),
  };
}
