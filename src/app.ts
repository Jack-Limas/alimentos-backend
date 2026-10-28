import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { readAppInfo, type AppInfo } from './config/app-info.js';
import type { Env } from './config/env.js';
import { buildLoggerOptions } from './config/logger.js';
import {
  alertsRoutes,
  createAlertsController,
  createAlertsService,
} from './modules/alerts/index.js';
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
  createCustomerController,
  createCustomerService,
  createPrismaCustomerRepository,
  customerRoutes,
  type CustomerRepository,
} from './modules/customers/index.js';
import {
  createDistributionController,
  createDistributionService,
  createPrismaDistributionRepository,
  distributionRoutes,
  type DistributionRepository,
} from './modules/distribution/index.js';
import {
  createHealthController,
  createHealthService,
  createPrismaDatabaseCheck,
  healthRoutes,
  type DatabaseCheck,
} from './modules/health/index.js';
import {
  createInventoryController,
  createInventoryMetricsService,
  createInventoryService,
  createPrismaInventoryRepository,
  inventoryRoutes,
  type InventoryRepository,
} from './modules/inventory/index.js';
import {
  createOrderController,
  createOrderService,
  createPrismaOrderRepository,
  orderRoutes,
  type OrderRepository,
} from './modules/orders/index.js';
import {
  createPrismaProductRepository,
  createProductController,
  createProductService,
  productRoutes,
  type ProductRepository,
} from './modules/products/index.js';
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
  products: ProductRepository;
  inventory: InventoryRepository;
  customers: CustomerRepository;
  orders: OrderRepository;
  distribution: DistributionRepository;
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
    | 'APP_TIMEZONE'
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
      products: createPrismaProductRepository(prisma),
      inventory: createPrismaInventoryRepository(prisma),
      customers: createPrismaCustomerRepository(prisma),
      orders: createPrismaOrderRepository(prisma),
      distribution: createPrismaDistributionRepository(prisma),
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

  const clock = deps.clock ?? systemClock;
  const auditService = createAuditService(repositories.auditLogs);
  const authService = createAuthService({
    users: repositories.users,
    refreshTokens: repositories.refreshTokens,
    loginAttempts: repositories.loginAttempts,
    audit: auditService,
    hasher: deps.passwordHasher ?? createBcryptHasher(),
    signAccessToken: (payload) => app.jwt.sign(payload),
    clock,
    config: {
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      loginMaxAttempts: env.LOGIN_MAX_ATTEMPTS,
      loginWindowMinutes: env.LOGIN_WINDOW_MINUTES,
    },
  });

  const inventoryMetrics = createInventoryMetricsService({
    inventory: repositories.inventory,
    clock,
    timeZone: env.APP_TIMEZONE,
  });
  const productService = createProductService({
    products: repositories.products,
    inventory: repositories.inventory,
    metrics: inventoryMetrics,
  });
  const inventoryService = createInventoryService({
    products: repositories.products,
    inventory: repositories.inventory,
    metrics: inventoryMetrics,
  });
  const customerService = createCustomerService({ customers: repositories.customers });
  const orderService = createOrderService({
    orders: repositories.orders,
    customers: repositories.customers,
    today: () => inventoryMetrics.today(),
  });
  const distributionService = createDistributionService({
    distribution: repositories.distribution,
    inventory: repositories.inventory,
    clock,
    timeZone: env.APP_TIMEZONE,
  });
  const alertsService = createAlertsService({
    products: repositories.products,
    orders: repositories.orders,
    metrics: inventoryMetrics,
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
  await app.register(productRoutes, {
    prefix: `${API_PREFIX}/products`,
    controller: createProductController(productService),
  });
  await app.register(inventoryRoutes, {
    prefix: `${API_PREFIX}/inventory`,
    controller: createInventoryController(inventoryService),
  });
  await app.register(customerRoutes, {
    prefix: `${API_PREFIX}/customers`,
    controller: createCustomerController(customerService),
  });
  await app.register(orderRoutes, {
    prefix: `${API_PREFIX}/orders`,
    controller: createOrderController(orderService),
  });
  await app.register(distributionRoutes, {
    prefix: `${API_PREFIX}/distribution`,
    controller: createDistributionController(distributionService),
  });
  await app.register(alertsRoutes, {
    prefix: `${API_PREFIX}/alerts`,
    controller: createAlertsController(alertsService),
  });

  return app;
}
