import { randomUUID } from 'node:crypto';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/index.js';
import type { Actor } from '../../shared/http/actor.js';
import { paginate, toSkipTake, type Paginated } from '../../shared/http/pagination.js';
import { AUDIT_ACTIONS, buildAuditEntry } from '../audit/index.js';
import type { PasswordHasher } from '../auth/password-hasher.js';
import type { RefreshTokenRepository } from '../auth/refresh-token.repository.js';
import type { SessionStatusLookup } from '../auth/session-status.js';
import { toUserDto, type UserDto } from './user.dto.js';
import type { UserRecord, UserRepository } from './user.repository.js';
import type {
  CreateUserBody,
  ResetPasswordBody,
  UpdateUserBody,
  UserListQuery,
} from './user.schemas.js';

export interface UserService {
  list(query: UserListQuery): Promise<Paginated<UserDto>>;
  create(input: CreateUserBody, actor: Actor): Promise<UserDto>;
  update(id: string, patch: UpdateUserBody, actor: Actor): Promise<UserDto>;
  resetPassword(id: string, input: ResetPasswordBody, actor: Actor): Promise<UserDto>;
}

export interface UserServiceDeps {
  users: UserRepository;
  refreshTokens: Pick<RefreshTokenRepository, 'revokeAllForUser'>;
  hasher: PasswordHasher;
  clock: Clock;
  /** MAX_MANAGED_USERS: unprotected users an ADMIN can have created. */
  maxManagedUsers: number;
  sessions?: Pick<SessionStatusLookup, 'forget'>;
  newId?: () => string;
}

function notFound(id: string): AppError {
  return new AppError(404, 'NOT_FOUND', 'User not found', { userId: id });
}

/** Seed accounts (real and demo) are never changed through the API. */
function assertNotProtected(user: UserRecord): void {
  if (user.isProtected) {
    throw new AppError(403, 'PROTECTED_ACCOUNT', 'This account cannot be changed from the app', {
      userId: user.id,
    });
  }
}

function selfLockout(message: string): AppError {
  return new AppError(409, 'SELF_LOCKOUT', message);
}

export function createUserService(deps: UserServiceDeps): UserService {
  const { users, refreshTokens, hasher, clock, maxManagedUsers, newId = randomUUID } = deps;

  /** Ends every session of the user: refresh families now, access tokens on their next request. */
  async function endSessions(userId: string): Promise<number> {
    const revoked = await refreshTokens.revokeAllForUser(userId, clock());
    deps.sessions?.forget(userId);
    return revoked;
  }

  async function findManageable(id: string): Promise<UserRecord> {
    const user = await users.findById(id);
    if (!user) throw notFound(id);
    assertNotProtected(user);
    return user;
  }

  return {
    async list(query) {
      const { items, total } = await users.list(
        { search: query.search, role: query.role, active: query.active },
        toSkipTake(query),
      );
      return paginate(items.map(toUserDto), total, query);
    },

    async create(input, actor) {
      const id = newId();
      const result = await users.createManaged(
        {
          id,
          email: input.email,
          name: input.name,
          role: input.role,
          passwordHash: await hasher.hash(input.temporaryPassword),
        },
        maxManagedUsers,
        buildAuditEntry({
          userId: actor.userId,
          action: AUDIT_ACTIONS.USER_CREATED,
          entity: 'User',
          entityId: id,
          // No email or name: the id and role are enough to follow it.
          metadata: { role: input.role },
          ip: actor.ip,
        }),
      );
      if (result.kind === 'duplicate') {
        throw new AppError(409, 'DUPLICATE', 'A user with this email already exists', {
          field: 'email',
        });
      }
      if (result.kind === 'limit') {
        throw new AppError(409, 'USER_LIMIT_REACHED', 'The limit of users has been reached', {
          limit: maxManagedUsers,
        });
      }
      return toUserDto(result.user);
    },

    async update(id, patch, actor) {
      const current = await findManageable(id);
      if (id === actor.userId) {
        if (patch.active === false) throw selfLockout('You cannot deactivate your own account');
        if (patch.role !== undefined && patch.role !== 'ADMIN') {
          throw selfLockout('You cannot remove your own ADMIN role');
        }
      }
      const result = await users.updateManaged(
        id,
        patch,
        buildAuditEntry({
          userId: actor.userId,
          action: AUDIT_ACTIONS.USER_UPDATED,
          entity: 'User',
          entityId: id,
          metadata: {
            fields: Object.keys(patch),
            ...(patch.role !== undefined ? { role: patch.role } : {}),
            ...(patch.active !== undefined ? { active: patch.active } : {}),
          },
          ip: actor.ip,
        }),
      );
      if (result.kind === 'not-found') throw notFound(id);
      if (result.kind === 'last-admin') {
        throw new AppError(409, 'LAST_ADMIN', 'At least one active ADMIN must remain');
      }
      const updated = result.user;
      // A new role or a deactivation ends every session: the next request (or
      // refresh) is rejected and the user must sign in again (or cannot).
      if (updated.role !== current.role || (current.active && !updated.active)) {
        await endSessions(id);
      } else {
        deps.sessions?.forget(id);
      }
      return toUserDto(updated);
    },

    async resetPassword(id, input, actor) {
      await findManageable(id);
      if (id === actor.userId) {
        throw selfLockout('Use /auth/change-password for your own password');
      }
      const updated = await users.setPassword(
        id,
        await hasher.hash(input.temporaryPassword),
        true,
        buildAuditEntry({
          userId: actor.userId,
          action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
          entity: 'User',
          entityId: id,
          ip: actor.ip,
        }),
      );
      await endSessions(id);
      return toUserDto(updated);
    },
  };
}
