import type { Role } from '@prisma/client';
import type { UserRecord } from './user.repository.js';

/** A user as GET/POST/PATCH /users return it: never the password hash. */
export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  isProtected: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

/** Explicit fields: a new column (or passwordHash) never leaks by accident. */
export function toUserDto(user: UserRecord): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    isProtected: user.isProtected,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt.toISOString(),
  };
}
