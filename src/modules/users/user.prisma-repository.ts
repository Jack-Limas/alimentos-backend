import type { Prisma, PrismaClient } from '@prisma/client';
import { auditLogData, isUniqueViolation } from '../../shared/db/prisma-helpers.js';
import type { UserFilter, UserPatch, UserRecord, UserRepository } from './user.repository.js';

const userSelect = {
  id: true,
  email: true,
  name: true,
  passwordHash: true,
  role: true,
  active: true,
  isProtected: true,
  mustChangePassword: true,
  createdAt: true,
} as const;

/**
 * Key of the transaction-level advisory lock that serializes user writes from
 * the API (the limit and the "at least one active ADMIN" rule are checked and
 * applied under it). Arbitrary but fixed ("AIQUSER" in ASCII).
 */
export const USER_WRITE_LOCK_KEY = 0x4149_5155_5345_52n;

function toWhere(filter: UserFilter): Prisma.UserWhereInput {
  return {
    ...(filter.search
      ? {
          OR: [
            { name: { contains: filter.search, mode: 'insensitive' } },
            { email: { contains: filter.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(filter.role ? { role: filter.role } : {}),
    ...(filter.active !== undefined ? { active: filter.active } : {}),
  };
}

/** Only the fields present in the patch (Prisma rejects explicit undefined). */
function toUpdateData(patch: UserPatch): Prisma.UserUpdateInput {
  const data: Prisma.UserUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.role !== undefined) data.role = patch.role;
  if (patch.active !== undefined) data.active = patch.active;
  return data;
}

/** Signals the transaction to roll back. */
class Refused extends Error {
  constructor(readonly kind: 'duplicate' | 'limit' | 'last-admin' | 'not-found') {
    super(kind);
  }
}

export function createPrismaUserRepository(prisma: PrismaClient): UserRepository {
  const lock = (tx: Prisma.TransactionClient) =>
    tx.$executeRaw`SELECT pg_advisory_xact_lock(${USER_WRITE_LOCK_KEY})`;

  return {
    findByEmail: (email): Promise<UserRecord | null> =>
      prisma.user.findUnique({ where: { email }, select: userSelect }),

    findById: (id): Promise<UserRecord | null> =>
      prisma.user.findUnique({ where: { id }, select: userSelect }),

    upsertByEmail: (input): Promise<UserRecord> =>
      prisma.user.upsert({
        where: { email: input.email },
        create: { ...input, active: true, isProtected: true, mustChangePassword: false },
        update: {
          name: input.name,
          passwordHash: input.passwordHash,
          role: input.role,
          isProtected: true,
          mustChangePassword: false,
        },
        select: userSelect,
      }),

    async list(filter, page) {
      const where = toWhere(filter);
      const [items, total] = await prisma.$transaction([
        prisma.user.findMany({
          where,
          // Protected (seed) accounts first, then by name.
          orderBy: [{ isProtected: 'desc' }, { name: 'asc' }, { id: 'asc' }],
          skip: page.skip,
          take: page.take,
          select: userSelect,
        }),
        prisma.user.count({ where }),
      ]);
      return { items, total };
    },

    async createManaged(user, limit, audit) {
      try {
        const created = await prisma.$transaction(async (tx) => {
          await lock(tx);
          if ((await tx.user.count({ where: { isProtected: false } })) >= limit) {
            throw new Refused('limit');
          }
          if (await tx.user.findUnique({ where: { email: user.email }, select: { id: true } })) {
            throw new Refused('duplicate');
          }
          const row = await tx.user.create({
            data: { ...user, active: true, isProtected: false, mustChangePassword: true },
            select: userSelect,
          });
          await tx.auditLog.create({ data: auditLogData(audit) });
          return row;
        });
        return { kind: 'created', user: created };
      } catch (error) {
        if (error instanceof Refused && (error.kind === 'limit' || error.kind === 'duplicate')) {
          return { kind: error.kind };
        }
        // A seed upsert with the same email can still win outside the lock.
        if (isUniqueViolation(error)) return { kind: 'duplicate' };
        throw error;
      }
    },

    async updateManaged(id, patch, audit) {
      try {
        const updated = await prisma.$transaction(async (tx) => {
          await lock(tx);
          const current = await tx.user.findUnique({ where: { id }, select: userSelect });
          if (!current) throw new Refused('not-found');
          const nextRole = patch.role ?? current.role;
          const nextActive = patch.active ?? current.active;
          const losesAdmin =
            current.role === 'ADMIN' && current.active && (nextRole !== 'ADMIN' || !nextActive);
          if (losesAdmin) {
            const others = await tx.user.count({
              where: { role: 'ADMIN', active: true, id: { not: id } },
            });
            if (others === 0) throw new Refused('last-admin');
          }
          const row = await tx.user.update({
            where: { id },
            data: toUpdateData(patch),
            select: userSelect,
          });
          await tx.auditLog.create({ data: auditLogData(audit) });
          return row;
        });
        return { kind: 'updated', user: updated };
      } catch (error) {
        if (
          error instanceof Refused &&
          (error.kind === 'not-found' || error.kind === 'last-admin')
        ) {
          return { kind: error.kind };
        }
        throw error;
      }
    },

    async setPassword(id, passwordHash, mustChangePassword, audit) {
      const [updated] = await prisma.$transaction([
        prisma.user.update({
          where: { id },
          data: { passwordHash, mustChangePassword },
          select: userSelect,
        }),
        prisma.auditLog.create({ data: auditLogData(audit) }),
      ]);
      return updated;
    },
  };
}
