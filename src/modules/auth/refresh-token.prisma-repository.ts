import type { PrismaClient } from '@prisma/client';
import type { RefreshTokenRecord, RefreshTokenRepository } from './refresh-token.repository.js';

const tokenSelect = {
  id: true,
  userId: true,
  tokenHash: true,
  familyId: true,
  expiresAt: true,
  revokedAt: true,
  replacedById: true,
  createdAt: true,
} as const;

/** Signals the transaction to roll back without creating the new token. */
class AlreadyRevokedError extends Error {}

export function createPrismaRefreshTokenRepository(prisma: PrismaClient): RefreshTokenRepository {
  return {
    create: (token): Promise<RefreshTokenRecord> =>
      prisma.refreshToken.create({ data: token, select: tokenSelect }),

    findByHash: (tokenHash): Promise<RefreshTokenRecord | null> =>
      prisma.refreshToken.findUnique({ where: { tokenHash }, select: tokenSelect }),

    async revokeFamily(familyId, revokedAt) {
      const { count } = await prisma.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt },
      });
      return count;
    },

    async rotate(currentId, revokedAt, next) {
      try {
        await prisma.$transaction(async (tx) => {
          // Conditional update: only the first concurrent rotation succeeds.
          const { count } = await tx.refreshToken.updateMany({
            where: { id: currentId, revokedAt: null },
            data: { revokedAt, replacedById: next.id },
          });
          if (count === 0) {
            throw new AlreadyRevokedError();
          }
          await tx.refreshToken.create({ data: next });
        });
        return true;
      } catch (error) {
        if (error instanceof AlreadyRevokedError) {
          return false;
        }
        throw error;
      }
    },
  };
}
