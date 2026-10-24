import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { readAppInfo, type AppInfo } from './config/app-info.js';
import type { Env } from './config/env.js';
import { buildLoggerOptions } from './config/logger.js';
import {
  createHealthController,
  createHealthService,
  createPrismaDatabaseCheck,
  healthRoutes,
  type DatabaseCheck,
} from './modules/health/index.js';
import errorHandler from './plugins/error-handler.js';
import security from './plugins/security.js';
import serverTiming from './plugins/server-timing.js';

export const API_PREFIX = '/api/v1';

export interface AppDeps {
  env: Pick<Env, 'NODE_ENV' | 'CORS_ORIGINS'>;
  /** Defaults to a real `SELECT 1` through Prisma. Tests inject a fake. */
  checkDatabase?: DatabaseCheck;
  appInfo?: AppInfo;
  logger?: NonNullable<FastifyServerOptions['logger']>;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;

  const app = Fastify({
    logger: deps.logger ?? buildLoggerOptions(env.NODE_ENV),
    // Render terminates TLS in a proxy; trust it for request.ip and protocol.
    trustProxy: true,
  });

  let checkDatabase = deps.checkDatabase;
  if (!checkDatabase) {
    // Lazy import so tests that inject a fake never instantiate PrismaClient.
    const { prisma } = await import('./lib/prisma.js');
    checkDatabase = createPrismaDatabaseCheck(prisma);
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  }

  await app.register(sensible);
  await app.register(errorHandler, { isProduction: env.NODE_ENV === 'production' });
  await app.register(serverTiming);
  await app.register(security, { corsOrigins: env.CORS_ORIGINS });

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

  // Root /health for the Render health check; full module under /api/v1.
  await app.register(healthRoutes, { controller: healthController, includeReadiness: false });
  await app.register(healthRoutes, {
    prefix: API_PREFIX,
    controller: healthController,
    includeReadiness: true,
  });

  return app;
}
