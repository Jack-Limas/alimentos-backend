import type { Role } from '@prisma/client';
import type { NewAuditLog } from '../audit/index.js';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  active: boolean;
  /** Seed accounts (real and demo): the API never edits, deactivates or resets them. */
  isProtected: boolean;
  /** Signed in with a temporary password: must change it before anything else. */
  mustChangePassword: boolean;
  createdAt: Date;
}

export interface UpsertUserInput {
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
}

export interface UserFilter {
  /** Name or email, case-insensitive. */
  search?: string | undefined;
  role?: Role | undefined;
  active?: boolean | undefined;
}

export interface NewManagedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
}

export interface UserPatch {
  name?: string | undefined;
  role?: Role | undefined;
  active?: boolean | undefined;
}

export type CreateManagedResult =
  | { kind: 'created'; user: UserRecord }
  | { kind: 'duplicate' }
  /** There are already `limit` unprotected users. */
  | { kind: 'limit' };

export type UpdateManagedResult =
  | { kind: 'updated'; user: UserRecord }
  | { kind: 'not-found' }
  /** The change would leave no active ADMIN. */
  | { kind: 'last-admin' };

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /**
   * Seed only: creates the user or updates it in place (idempotent), always
   * protected and without a pending password change.
   */
  upsertByEmail(input: UpsertUserInput): Promise<UserRecord>;
  list(
    filter: UserFilter,
    page: { skip: number; take: number },
  ): Promise<{ items: UserRecord[]; total: number }>;
  /**
   * Creates an unprotected user that must change its password, with its audit
   * row, in one transaction serialized with the other user writes: the limit
   * and the email are checked under the same lock, so concurrent creations can
   * never exceed it.
   */
  createManaged(
    user: NewManagedUser,
    limit: number,
    audit: NewAuditLog,
  ): Promise<CreateManagedResult>;
  /**
   * Applies the patch with its audit row in one transaction under the same
   * lock, refusing (writing nothing) when no active ADMIN would remain.
   */
  updateManaged(id: string, patch: UserPatch, audit: NewAuditLog): Promise<UpdateManagedResult>;
  /** New password hash and whether it must be changed at the next sign-in, with its audit row. */
  setPassword(
    id: string,
    passwordHash: string,
    mustChangePassword: boolean,
    audit: NewAuditLog,
  ): Promise<UserRecord>;
}
