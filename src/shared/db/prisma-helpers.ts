import { Prisma } from '@prisma/client';
import type { NewAuditLog } from '../../modules/audit/index.js';

/** Writes a number as an exact Decimal(12,3) string (no binary float digits). */
export function toDecimalInput(value: number): string {
  return value.toFixed(3);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Audit row data for `tx.auditLog.create` inside another repository's transaction. */
export function auditLogData(audit: NewAuditLog): Prisma.AuditLogUncheckedCreateInput {
  return { ...audit, metadata: audit.metadata ?? Prisma.DbNull };
}
