import { randomUUID } from 'node:crypto';
import type { Role } from '@prisma/client';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/index.js';
import { AUDIT_ACTIONS } from '../audit/audit-actions.js';
import type { AuditService } from '../audit/audit.service.js';
import type { UserRecord, UserRepository } from '../users/user.repository.js';
import type { LoginAttemptRepository } from './login-attempt.repository.js';
import type { PasswordHasher } from './password-hasher.js';
import { generateRefreshToken, hashRefreshToken } from './refresh-token.js';
import type { RefreshTokenRecord, RefreshTokenRepository } from './refresh-token.repository.js';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface RequestContext {
  ip: string;
  userAgent: string | null;
}

export interface IssuedRefreshToken {
  /** Raw opaque token: only ever sent in the HttpOnly cookie, never in a body. */
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface LoginResult extends IssuedRefreshToken {
  accessToken: string;
  user: PublicUser;
}

export interface RefreshResult extends IssuedRefreshToken {
  accessToken: string;
}

export interface AuthConfig {
  refreshTokenTtlDays: number;
  loginMaxAttempts: number;
  loginWindowMinutes: number;
}

export interface AuthServiceDeps {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  loginAttempts: LoginAttemptRepository;
  audit: AuditService;
  hasher: PasswordHasher;
  signAccessToken: (payload: AccessTokenPayload) => string;
  clock: Clock;
  config: AuthConfig;
}

export interface AuthService {
  login(
    credentials: { email: string; password: string },
    ctx: RequestContext,
  ): Promise<LoginResult>;
  refresh(refreshToken: string | undefined, ctx: RequestContext): Promise<RefreshResult>;
  logout(refreshToken: string | undefined, ctx: RequestContext): Promise<void>;
  me(userId: string): Promise<PublicUser>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// One message for every failure so responses never reveal whether an email exists.
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
const SESSION_INVALID_MESSAGE = 'Session is invalid or has expired';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

function unauthenticated(message = SESSION_INVALID_MESSAGE): AppError {
  return new AppError(401, 'UNAUTHENTICATED', message);
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { users, refreshTokens, loginAttempts, audit, hasher, clock, config } = deps;
  const windowMs = config.loginWindowMinutes * MINUTE_MS;

  function newRefreshToken(): IssuedRefreshToken & { id: string; tokenHash: string } {
    const refreshToken = generateRefreshToken();
    return {
      id: randomUUID(),
      refreshToken,
      tokenHash: hashRefreshToken(refreshToken),
      refreshExpiresAt: new Date(clock().getTime() + config.refreshTokenTtlDays * DAY_MS),
    };
  }

  /** Seconds until the (email, ip) pair can try again, or null if not blocked. */
  async function blockedForSeconds(email: string, ip: string): Promise<number | null> {
    const now = clock();
    const windowStart = new Date(now.getTime() - windowMs);
    // A successful login resets the counter for that (email, ip) pair.
    const lastSuccess = await loginAttempts.lastSuccessAt(email, ip);
    const since = lastSuccess && lastSuccess > windowStart ? lastSuccess : windowStart;
    const failures = await loginAttempts.failuresSince(email, ip, since);
    if (failures.length < config.loginMaxAttempts) {
      return null;
    }
    // The block lifts when enough old failures leave the window.
    const releasing = failures[failures.length - config.loginMaxAttempts] ?? now;
    const retryAt = releasing.getTime() + windowMs;
    return Math.max(1, Math.ceil((retryAt - now.getTime()) / 1000));
  }

  async function revokeForReuse(token: RefreshTokenRecord, ctx: RequestContext): Promise<void> {
    await refreshTokens.revokeFamily(token.familyId, clock());
    await audit.record({
      userId: token.userId,
      action: AUDIT_ACTIONS.TOKEN_REUSE_DETECTED,
      entity: 'RefreshToken',
      entityId: token.familyId,
      metadata: { familyId: token.familyId, userAgent: ctx.userAgent },
      ip: ctx.ip,
    });
  }

  return {
    async login(credentials, ctx) {
      const email = normalizeEmail(credentials.email);

      const retryAfter = await blockedForSeconds(email, ctx.ip);
      if (retryAfter !== null) {
        await audit.record({
          action: AUDIT_ACTIONS.LOGIN_BLOCKED,
          entity: 'User',
          metadata: { email, retryAfterSeconds: retryAfter },
          ip: ctx.ip,
        });
        throw new AppError(
          429,
          'TOO_MANY_REQUESTS',
          'Too many failed login attempts, try again later',
          { retryAfterSeconds: retryAfter },
          { 'Retry-After': String(retryAfter) },
        );
      }

      const user = await users.findByEmail(email);
      const passwordOk = user
        ? await hasher.compare(credentials.password, user.passwordHash)
        : await hasher.compareWithDummy(credentials.password);

      if (!user || !passwordOk || !user.active) {
        await loginAttempts.record({ email, ip: ctx.ip, success: false, createdAt: clock() });
        throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
      }

      await loginAttempts.record({ email, ip: ctx.ip, success: true, createdAt: clock() });

      const familyId = randomUUID();
      const issued = newRefreshToken();
      await refreshTokens.create({
        id: issued.id,
        userId: user.id,
        tokenHash: issued.tokenHash,
        familyId,
        expiresAt: issued.refreshExpiresAt,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      await audit.record({
        userId: user.id,
        action: AUDIT_ACTIONS.LOGIN_SUCCESS,
        entity: 'User',
        entityId: user.id,
        metadata: { familyId, userAgent: ctx.userAgent },
        ip: ctx.ip,
      });

      return {
        accessToken: deps.signAccessToken({ sub: user.id, role: user.role }),
        refreshToken: issued.refreshToken,
        refreshExpiresAt: issued.refreshExpiresAt,
        user: toPublicUser(user),
      };
    },

    async refresh(refreshToken, ctx) {
      if (!refreshToken) {
        throw unauthenticated('Missing refresh token');
      }
      const current = await refreshTokens.findByHash(hashRefreshToken(refreshToken));
      if (!current) {
        throw unauthenticated();
      }

      // A revoked token coming back means it was stolen or replayed: kill the whole family.
      if (current.revokedAt !== null) {
        await revokeForReuse(current, ctx);
        throw unauthenticated();
      }

      if (current.expiresAt.getTime() <= clock().getTime()) {
        throw unauthenticated();
      }

      const user = await users.findById(current.userId);
      if (!user?.active) {
        await refreshTokens.revokeFamily(current.familyId, clock());
        throw unauthenticated();
      }

      const next = newRefreshToken();
      const rotated = await refreshTokens.rotate(current.id, clock(), {
        id: next.id,
        userId: user.id,
        tokenHash: next.tokenHash,
        familyId: current.familyId,
        expiresAt: next.refreshExpiresAt,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      if (!rotated) {
        // Another request rotated this token first: same treatment as reuse.
        await revokeForReuse(current, ctx);
        throw unauthenticated();
      }

      return {
        accessToken: deps.signAccessToken({ sub: user.id, role: user.role }),
        refreshToken: next.refreshToken,
        refreshExpiresAt: next.refreshExpiresAt,
      };
    },

    async logout(refreshToken, ctx) {
      if (!refreshToken) {
        return;
      }
      const current = await refreshTokens.findByHash(hashRefreshToken(refreshToken));
      if (!current) {
        return;
      }
      await refreshTokens.revokeFamily(current.familyId, clock());
      await audit.record({
        userId: current.userId,
        action: AUDIT_ACTIONS.LOGOUT,
        entity: 'RefreshToken',
        entityId: current.familyId,
        metadata: { familyId: current.familyId },
        ip: ctx.ip,
      });
    },

    async me(userId) {
      const user = await users.findById(userId);
      if (!user?.active) {
        throw unauthenticated();
      }
      return toPublicUser(user);
    },
  };
}
