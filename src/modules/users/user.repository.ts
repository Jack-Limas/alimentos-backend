import type { Role } from '@prisma/client';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  active: boolean;
}

export interface UpsertUserInput {
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Creates the user or updates it in place (idempotent seed). */
  upsertByEmail(input: UpsertUserInput): Promise<UserRecord>;
}
