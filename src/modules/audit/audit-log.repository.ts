import type { Prisma } from '@prisma/client';

export interface AuditLogRecord {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Prisma.JsonValue;
  ip: string | null;
  createdAt: Date;
}

export interface NewAuditLog {
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Prisma.InputJsonValue | null;
  ip: string | null;
}

export interface AuditLogFilter {
  action?: string | undefined;
  userId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface AuditLogRepository {
  create(entry: NewAuditLog): Promise<void>;
  /** Newest first. */
  list(
    filter: AuditLogFilter,
    page: { skip: number; take: number },
  ): Promise<{ items: AuditLogRecord[]; total: number }>;
}
