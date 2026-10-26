import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { readAppInfo, type AppInfo } from './config/app-info.js';
import type { Env } from './config/env.js';
import { buildLoggerOptions } from './config/logger.js';
import {
  auditRoutes,
  createAuditController,
  createAuditService,
  createPrismaAuditLogRepository,
  type AuditLogRepository,
} from './modules/audit/index.js';
import {
  authRoutes,
  createAuthController,
  createAuthService,
  createBcryptHasher,
  createPrismaLoginAttemptRepository,
  createPrismaRefreshTokenRepository,
  type LoginAttemptRepository,
  type PasswordHasher,
  type RefreshTokenRepository,
} from './modules/auth/index.js';
import {
  createHealthController,
  createHealthService,
  createPrismaDatabaseCheck,
  healthRoutes,
  type DatabaseCheck,
} from './modules/health/index.js';
import { createPrismaUserRepository, type UserRepository } from './modules/users/index.js';
import auth from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import security from './plugins/security.js';
import serverTiming from './plugins/server-timing.js';
import { systemClock, type Clock } from './shared/clock.js';

export const API_PREFIX = '/api/v1';

export interface AppRepositories {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  loginAttempts: LoginAttemptRepository;
  auditLogs: AuditLogRepository;
}

export interface AppDeps {
  env: Pick<
    Env,
    | 'NODE_ENV'
    | 'CORS_ORIGINS'
    | 'JWT_ACCESS_SECRET'
    | 'ACCESS_TOKEN_TTL'
    | 'REFRESH_TOKEN_TTL_DAYS'
    | 'LOGIN_MAX_ATTEMPTS'
    | 'LOGIN_WINDOW_MINUTES'
  >;
  /** Defaults to a real `SELECT 1` through Prisma. Tests inject a fake. */
  checkDatabase?: DatabaseCheck;
  /** Defaults to the Prisma implementations. Tests inject in-memory ones. */
  repositories?: AppRepositories;
  passwordHasher?: PasswordHasher;
  clock?: Clock;
  appInfo?: AppInfo;
  logger?: NonNullable<FastifyServerOptions['logger']>;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;

  const app = Fastify({
    logger: deps.logger ?? buildLoggerOptions(env.NODE_ENV),
    // Render (and Cloudflare in front of it) terminate the connection in a proxy.
    // Without trusting X-Forwarded-For, request.ip would be the proxy's address and
    // the per (email, ip) login limit would lump every user together.
    trustProxy: true,
  });

  let checkDatabase = deps.checkDatabase;
  let repositories = deps.repositories;
  if (!checkDatabase || !repositories) {
    // Lazy import so tests that inject fakes never instantiate PrismaClient.
    const { prisma } = await import('./lib/prisma.js');
    checkDatabase ??= createPrismaDatabaseCheck(prisma);
    repositories ??= {
      users: createPrismaUserRepository(prisma),
      refreshTokens: createPrismaRefreshTokenRepository(prisma),
      loginAttempts: createPrismaLoginAttemptRepository(prisma),
      auditLogs: createPrismaAuditLogRepository(prisma),
    };
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  }

  await app.register(sensible);
  await app.register(errorHandler, { isProduction: env.NODE_ENV === 'production' });
  await app.register(serverTiming);
  await app.register(security, { corsOrigins: env.CORS_ORIGINS });
  await app.register(auth, {
    jwtAccessSecret: env.JWT_ACCESS_SECRET,
    accessTokenTtl: env.ACCESS_TOKEN_TTL,
  });

  const appInfo = deps.appInfo ?? readAppInfo();
  const healthController = createHealthController(
    createHealthService({
      serviceName: appInfo.name,
      version: appInfo.version,
      checkDatabase,
      onDatabaseError: (error) => {
        app.log.warn({ err: error }, 'Readiness check failed: database unreachable');
      },
    }),
  );

  const auditService = createAuditService(repositories.auditLogs);
  const authService = createAuthService({
    users: repositories.users,
    refreshTokens: repositories.refreshTokens,
    loginAttempts: repositories.loginAttempts,
    audit: auditService,
    hasher: deps.passwordHasher ?? createBcryptHasher(),
    signAccessToken: (payload) => app.jwt.sign(payload),
    clock: deps.clock ?? systemClock,
    config: {
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      loginMaxAttempts: env.LOGIN_MAX_ATTEMPTS,
      loginWindowMinutes: env.LOGIN_WINDOW_MINUTES,
    },
  });

  // Root /health for the Render health check; full module under /api/v1.
  await app.register(healthRoutes, { controller: healthController, includeReadiness: false });
  await app.register(healthRoutes, {
    prefix: API_PREFIX,
    controller: healthController,
    includeReadiness: true,
  });
  await app.register(authRoutes, {
    prefix: `${API_PREFIX}/auth`,
    controller: createAuthController(authService),
  });
  await app.register(auditRoutes, {
    prefix: API_PREFIX,
    controller: createAuditController(auditService),
  });

  return app;
}
