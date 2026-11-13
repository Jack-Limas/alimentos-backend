import { randomUUID } from 'node:crypto';
import type {
  AuditLogRecord,
  AuditLogRepository,
} from '../../src/modules/audit/audit-log.repository.js';
import type { LoginAttemptRepository } from '../../src/modules/auth/login-attempt.repository.js';
import type {
  RefreshTokenRecord,
  RefreshTokenRepository,
} from '../../src/modules/auth/refresh-token.repository.js';
import type { NewAuditLog } from '../../src/modules/audit/index.js';
import type {
  UserFilter,
  UserRecord,
  UserRepository,
} from '../../src/modules/users/user.repository.js';

// In-memory implementations of the same repository interfaces used in production.
// Tests exercise the real services and routes without a database.

export function createInMemoryUserRepository(
  initial: UserRecord[] = [],
  auditLog?: AuditLogRepository,
) {
  const users = new Map(initial.map((user) => [user.id, { ...user }]));
  const audit = async (entry: NewAuditLog) => {
    await auditLog?.create(entry);
  };
  const matches = (user: UserRecord, filter: UserFilter) => {
    const search = filter.search?.toLowerCase();
    return (
      (!search ||
        user.name.toLowerCase().includes(search) ||
        user.email.toLowerCase().includes(search)) &&
      (!filter.role || user.role === filter.role) &&
      (filter.active === undefined || user.active === filter.active)
    );
  };

  const repository: UserRepository & { users: Map<string, UserRecord> } = {
    users,
    findByEmail: (email) =>
      Promise.resolve([...users.values()].find((user) => user.email === email) ?? null),
    findById: (id) => Promise.resolve(users.get(id) ?? null),
    upsertByEmail(input) {
      const existing = [...users.values()].find((user) => user.email === input.email);
      const user: UserRecord = existing
        ? { ...existing, ...input, isProtected: true, mustChangePassword: false }
        : {
            id: randomUUID(),
            active: true,
            isProtected: true,
            mustChangePassword: false,
            createdAt: new Date(),
            ...input,
          };
      users.set(user.id, user);
      return Promise.resolve(user);
    },
    list(filter, page) {
      const all = [...users.values()]
        .filter((user) => matches(user, filter))
        .sort(
          (a, b) =>
            Number(b.isProtected) - Number(a.isProtected) ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id),
        );
      return Promise.resolve({
        items: all.slice(page.skip, page.skip + page.take),
        total: all.length,
      });
    },
    async createManaged(input, limit, entry) {
      if ([...users.values()].filter((user) => !user.isProtected).length >= limit) {
        return { kind: 'limit' };
      }
      if ([...users.values()].some((user) => user.email === input.email)) {
        return { kind: 'duplicate' };
      }
      const user: UserRecord = {
        ...input,
        active: true,
        isProtected: false,
        mustChangePassword: true,
        createdAt: new Date(),
      };
      users.set(user.id, user);
      await audit(entry);
      return { kind: 'created', user: { ...user } };
    },
    async updateManaged(id, patch, entry) {
      const current = users.get(id);
      if (!current) return { kind: 'not-found' };
      const next: UserRecord = {
        ...current,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
      };
      const losesAdmin =
        current.role === 'ADMIN' && current.active && (next.role !== 'ADMIN' || !next.active);
      const otherAdmins = [...users.values()].filter(
        (user) => user.id !== id && user.role === 'ADMIN' && user.active,
      );
      if (losesAdmin && otherAdmins.length === 0) return { kind: 'last-admin' };
      users.set(id, next);
      await audit(entry);
      return { kind: 'updated', user: { ...next } };
    },
    async setPassword(id, passwordHash, mustChangePassword, entry) {
      const current = users.get(id);
      if (!current) throw new Error(`unknown user ${id}`);
      const next = { ...current, passwordHash, mustChangePassword };
      users.set(id, next);
      await audit(entry);
      return { ...next };
    },
  };
  return repository;
}

export function createInMemoryRefreshTokenRepository() {
  const tokens = new Map<string, RefreshTokenRecord>();

  const repository: RefreshTokenRepository & { tokens: Map<string, RefreshTokenRecord> } = {
    tokens,
    create(token) {
      const record: RefreshTokenRecord = {
        id: token.id,
        userId: token.userId,
        tokenHash: token.tokenHash,
        familyId: token.familyId,
        expiresAt: token.expiresAt,
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
      };
      tokens.set(record.id, record);
      return Promise.resolve(record);
    },
    findByHash: (tokenHash) =>
      Promise.resolve([...tokens.values()].find((token) => token.tokenHash === tokenHash) ?? null),
    revokeFamily(familyId, revokedAt) {
      let count = 0;
      for (const token of tokens.values()) {
        if (token.familyId === familyId && token.revokedAt === null) {
          token.revokedAt = revokedAt;
          count += 1;
        }
      }
      return Promise.resolve(count);
    },
    revokeAllForUser(userId, revokedAt, exceptFamilyId) {
      let count = 0;
      for (const token of tokens.values()) {
        if (
          token.userId === userId &&
          token.revokedAt === null &&
          token.familyId !== exceptFamilyId
        ) {
          token.revokedAt = revokedAt;
          count += 1;
        }
      }
      return Promise.resolve(count);
    },
    async rotate(currentId, revokedAt, next) {
      const current = tokens.get(currentId);
      if (current?.revokedAt !== null) {
        return false;
      }
      current.revokedAt = revokedAt;
      current.replacedById = next.id;
      await repository.create(next);
      return true;
    },
  };
  return repository;
}

interface StoredAttempt {
  email: string;
  ip: string;
  success: boolean;
  createdAt: Date;
}

export function createInMemoryLoginAttemptRepository() {
  const attempts: StoredAttempt[] = [];

  const repository: LoginAttemptRepository & { attempts: StoredAttempt[] } = {
    attempts,
    record(attempt) {
      attempts.push({ ...attempt });
      return Promise.resolve();
    },
    failuresSince: (email, ip, since) =>
      Promise.resolve(
        attempts
          .filter((a) => a.email === email && a.ip === ip && !a.success && a.createdAt >= since)
          .map((a) => a.createdAt)
          .sort((a, b) => a.getTime() - b.getTime()),
      ),
    lastSuccessAt(email, ip) {
      const successes = attempts
        .filter((a) => a.email === email && a.ip === ip && a.success)
        .map((a) => a.createdAt.getTime());
      return Promise.resolve(successes.length ? new Date(Math.max(...successes)) : null);
    },
  };
  return repository;
}

export function createInMemoryAuditLogRepository() {
  const entries: AuditLogRecord[] = [];

  const repository: AuditLogRepository & { entries: AuditLogRecord[] } = {
    entries,
    create(entry) {
      entries.push({
        id: randomUUID(),
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        metadata: entry.metadata as AuditLogRecord['metadata'],
        ip: entry.ip,
        // Strictly increasing so "newest first" is deterministic within one test.
        createdAt: new Date(Date.now() + entries.length),
      });
      return Promise.resolve();
    },
    list(filter, page) {
      const filtered = entries
        .filter((e) => !filter.action || e.action === filter.action)
        .filter((e) => !filter.userId || e.userId === filter.userId)
        .filter((e) => !filter.from || e.createdAt >= filter.from)
        .filter((e) => !filter.to || e.createdAt <= filter.to)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return Promise.resolve({
        items: filtered.slice(page.skip, page.skip + page.take),
        total: filtered.length,
      });
    },
  };
  return repository;
}
