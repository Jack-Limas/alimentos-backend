import type { Prisma } from '@prisma/client';
import {
  paginate,
  toSkipTake,
  type Paginated,
  type PaginationQuery,
} from '../../shared/http/pagination.js';
import type { AuditLogFilter, AuditLogRecord, AuditLogRepository } from './audit-log.repository.js';

export interface AuditEntryInput {
  userId?: string | null | undefined;
  action: string;
  entity: string;
  entityId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  ip?: string | null | undefined;
}

export interface AuditLogDto {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Prisma.JsonValue;
  ip: string | null;
  createdAt: string;
}

export interface AuditService {
  record(entry: AuditEntryInput): Promise<void>;
  list(filter: AuditLogFilter, page: PaginationQuery): Promise<Paginated<AuditLogDto>>;
}

/** Any key that looks like a credential is dropped, at any depth. */
const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie/i;

export function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeMetadata);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .map(([key, nested]) => [key, sanitizeMetadata(nested)]),
    );
  }
  return value;
}

function toDto(record: AuditLogRecord): AuditLogDto {
  return { ...record, createdAt: record.createdAt.toISOString() };
}

export function createAuditService(repository: AuditLogRepository): AuditService {
  return {
    async record(entry) {
      await repository.create({
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata
          ? (sanitizeMetadata(entry.metadata) as Prisma.InputJsonValue)
          : null,
        ip: entry.ip ?? null,
      });
    },

    async list(filter, page) {
      const { items, total } = await repository.list(filter, toSkipTake(page));
      return paginate(items.map(toDto), total, page);
    },
  };
}
