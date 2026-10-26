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
import type { UserRecord, UserRepository } from '../../src/modules/users/user.repository.js';

// In-memory implementations of the same repository interfaces used in production.
// Tests exercise the real services and routes without a database.

export function createInMemoryUserRepository(initial: UserRecord[] = []) {
  const users = new Map(initial.map((user) => [user.id, { ...user }]));

  const repository: UserRepository & { users: Map<string, UserRecord> } = {
    users,
    findByEmail: (email) =>
      Promise.resolve([...users.values()].find((user) => user.email === email) ?? null),
    findById: (id) => Promise.resolve(users.get(id) ?? null),
    upsertByEmail(input) {
      const existing = [...users.values()].find((user) => user.email === input.email);
      const user: UserRecord = existing
        ? { ...existing, ...input }
        : { id: randomUUID(), active: true, ...input };
      users.set(user.id, user);
      return Promise.resolve(user);
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
