import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { readAppInfo, type AppInfo } from './config/app-info.js';
import type { Env } from './config/env.js';
import { buildLoggerOptions } from './config/logger.js';
import { adminRoutes, createAdminController } from './modules/admin/index.js';
import {
  aiRoutes,
  createAiClient,
  createAiController,
  createAiGateway,
  createAiService,
  createRateLimiter,
  type RateLimiter,
} from './modules/ai/index.js';
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
import { createImpactService, publicRoutes } from './modules/public/index.js';
import {
  benchmarkRoutes,
  createBenchmarkController,
  createBenchmarkService,
} from './modules/benchmarks/index.js';
import {
  createApiMetrics,
  createMetricsController,
  createMetricsService,
  createWebVitalsStore,
  metricsRoutes,
} from './modules/metrics/index.js';
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
import {
  createPrismaReportsRepository,
  createReportsController,
  createReportsService,
  reportsRoutes,
  type ReportsRepository,
} from './modules/reports/index.js';
import { createPrismaUserRepository, type UserRepository } from './modules/users/index.js';
import apiMetricsPlugin from './plugins/api-metrics.js';
import auth from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import security from './plugins/security.js';
import serverTiming from './plugins/server-timing.js';
import { systemClock, type Clock } from './shared/clock.js';
import { PUBLIC_RATE_LIMIT } from './shared/http/rate-limiter.js';
import { createLazyTaskPool, type TaskPool } from './workers/index.js';

export const API_PREFIX = '/api/v1';
/** Largest JSON body accepted (Fastify's default, set explicitly): nothing in the API needs more. */
export const BODY_LIMIT_BYTES = 1_048_576;

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
  reports: ReportsRepository;
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
    | 'AI_SERVICE_URL'
    | 'AI_INTERNAL_KEY'
    | 'AI_TIMEOUT_MS'
  > &
    Partial<
      Pick<
        Env,
        'WORKER_POOL_SIZE' | 'WORKER_TASK_TIMEOUT_MS' | 'TRUST_PROXY' | 'BENCHMARK_MAX_SIZE'
      >
    >;
  /** Defaults to a real `SELECT 1` through Prisma. Tests inject a fake. */
  checkDatabase?: DatabaseCheck;
  /** Defaults to the Prisma implementations. Tests inject in-memory ones. */
  repositories?: AppRepositories;
  passwordHasher?: PasswordHasher;
  clock?: Clock;
  appInfo?: AppInfo;
  logger?: NonNullable<FastifyServerOptions['logger']>;
  /** Worker threads for reports and the benchmark (lazy by default). */
  taskPool?: TaskPool;
  /** Start the worker threads at once (the server does; tests keep them lazy). */
  warmWorkers?: boolean;
  /** Rate limit of GET /public/impact per IP (tests inject one with a fake clock). */
  publicLimiter?: RateLimiter;
  /** Tests inject a fake fetch for alimentos-ai, a clock for its cool-down and a limiter. */
  ai?: { fetch?: typeof fetch; now?: () => number; limiter?: RateLimiter };
}

/**
 * TRUST_PROXY as Fastify expects it: `true` trusts the whole X-Forwarded-For
 * chain; a number N trusts the N closest hops (the same rule proxy-addr applies
 * to a number, which Fastify's types do not accept).
 */
export function trustProxyOption(
  value: boolean | number,
): boolean | ((address: string, hop: number) => boolean) {
  return typeof value === 'number' ? (_address, hop) => hop < value : value;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;

  const app = Fastify({
    logger: deps.logger ?? buildLoggerOptions(env.NODE_ENV),
    // Render (and Cloudflare in front of it) terminate the connection in a proxy.
    // Without trusting X-Forwarded-For, request.ip would be the proxy's address and
    // the per (email, ip) login limit would lump every user together. TRUST_PROXY
    // narrows it to the real number of hops (GET /admin/network-info shows them).
    trustProxy: trustProxyOption(env.TRUST_PROXY ?? true),
    bodyLimit: BODY_LIMIT_BYTES,
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
      reports: createPrismaReportsRepository(prisma),
    };
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  }

  await app.register(sensible);
  await app.register(errorHandler, { isProduction: env.NODE_ENV === 'production' });
  await app.register(serverTiming);
  // Response times per route pattern for GET /metrics/api (in memory, per process).
  const apiMetrics = createApiMetrics();
  await app.register(apiMetricsPlugin, { metrics: apiMetrics });
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
  // Optional: without AI_SERVICE_URL / AI_INTERNAL_KEY the AI is "not configured",
  // AI_ASSISTED degrades to BALANCED and /ai answers 503 with NOT_CONFIGURED.
  const aiClient = createAiClient({
    baseUrl: env.AI_SERVICE_URL,
    internalKey: env.AI_INTERNAL_KEY,
    timeoutMs: env.AI_TIMEOUT_MS,
    ...(deps.ai?.fetch ? { fetch: deps.ai.fetch } : {}),
    ...(deps.ai?.now ? { now: deps.ai.now } : {}),
  });
  if (!aiClient.configured) {
    app.log.info('AI service not configured: AI_ASSISTED degrades to the rules result');
  }
  const aiGateway = createAiGateway({ client: aiClient, audit: auditService });
  const distributionService = createDistributionService({
    distribution: repositories.distribution,
    inventory: repositories.inventory,
    clock,
    timeZone: env.APP_TIMEZONE,
    ai: aiGateway,
  });
  const alertsService = createAlertsService({
    products: repositories.products,
    orders: repositories.orders,
    metrics: inventoryMetrics,
  });
  const aiService = createAiService({
    gateway: aiGateway,
    distribution: repositories.distribution,
    distributionService,
    products: repositories.products,
    customers: repositories.customers,
    metrics: inventoryMetrics,
    inventory: inventoryService,
    alerts: alertsService,
    clock,
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
  // CPU work (report formatting, the benchmark) runs off the event loop, in worker threads.
  const taskPool =
    deps.taskPool ??
    createLazyTaskPool({
      size: env.WORKER_POOL_SIZE ?? 2,
      taskTimeoutMs: env.WORKER_TASK_TIMEOUT_MS ?? 30_000,
    });
  if (deps.warmWorkers) taskPool.warm();
  app.addHook('onClose', async () => {
    await taskPool.close();
  });
  const reportsService = createReportsService({
    reports: repositories.reports,
    products: repositories.products,
    metrics: inventoryMetrics,
    pool: taskPool,
    audit: auditService,
    clock,
    timeZone: env.APP_TIMEZONE,
  });
  await app.register(reportsRoutes, {
    prefix: `${API_PREFIX}/reports`,
    controller: createReportsController(reportsService),
  });

  await app.register(benchmarkRoutes, {
    prefix: `${API_PREFIX}/benchmarks`,
    controller: createBenchmarkController(
      createBenchmarkService({ pool: taskPool, audit: auditService }),
      env.BENCHMARK_MAX_SIZE,
    ),
  });

  await app.register(publicRoutes, {
    prefix: `${API_PREFIX}/public`,
    impact: createImpactService({
      reports: repositories.reports,
      clock,
      timeZone: env.APP_TIMEZONE,
    }),
    limiter: deps.publicLimiter ?? createRateLimiter(PUBLIC_RATE_LIMIT),
  });

  const metricsService = createMetricsService({
    apiMetrics,
    webVitals: createWebVitalsStore(),
  });
  app.addHook('onClose', (_instance, done) => {
    metricsService.close();
    done();
  });
  await app.register(metricsRoutes, {
    prefix: `${API_PREFIX}/metrics`,
    controller: createMetricsController(metricsService),
  });
  await app.register(adminRoutes, {
    prefix: `${API_PREFIX}/admin`,
    controller: createAdminController({
      audit: auditService,
      trustProxy: env.TRUST_PROXY ?? true,
    }),
  });
  await app.register(aiRoutes, {
    prefix: `${API_PREFIX}/ai`,
    controller: createAiController(aiService),
    limiter: deps.ai?.limiter ?? createRateLimiter(),
  });

  return app;
}
