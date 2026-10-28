import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps, type AppRepositories } from '../../src/app.js';
import { createBcryptHasher } from '../../src/modules/auth/password-hasher.js';
import {
  createInMemoryAuditLogRepository,
  createInMemoryLoginAttemptRepository,
  createInMemoryRefreshTokenRepository,
  createInMemoryUserRepository,
} from './in-memory-repositories.js';
import {
  createInMemoryInventoryRepository,
  createInMemoryProductRepository,
} from './in-memory-inventory.js';
import {
  createInMemoryCustomerRepository,
  createInMemoryOrderRepository,
} from './in-memory-orders.js';

export const ALLOWED_ORIGIN = 'http://localhost:3000';
export const TEST_JWT_SECRET = 'test-jwt-access-secret-0123456789abcdef0123';

export const dbUp = (): Promise<void> => Promise.resolve();
export const dbDown = (): Promise<void> => Promise.reject(new Error('connection refused'));

/** Low bcrypt cost keeps tests fast; production uses cost 12. */
export const testHasher = createBcryptHasher(4);

export function createTestRepositories() {
  const auditLogs = createInMemoryAuditLogRepository();
  // Every repository writes its audit rows into the same in-memory audit log.
  const products = createInMemoryProductRepository(auditLogs);
  const inventory = createInMemoryInventoryRepository(auditLogs, products.products);
  const customers = createInMemoryCustomerRepository(auditLogs);
  return {
    users: createInMemoryUserRepository(),
    refreshTokens: createInMemoryRefreshTokenRepository(),
    loginAttempts: createInMemoryLoginAttemptRepository(),
    auditLogs,
    products,
    inventory,
    customers,
    // Orders read products and customers and give stock back to the same lots.
    orders: createInMemoryOrderRepository(auditLogs, {
      products: products.products,
      customers: customers.customers,
      lots: inventory.lots,
      movements: inventory.movements,
    }),
  } satisfies AppRepositories;
}

export type TestRepositories = ReturnType<typeof createTestRepositories>;

type TestAppOverrides = Partial<Omit<AppDeps, 'env'>> & { env?: Partial<AppDeps['env']> };

/** Builds the app with a simulated database and in-memory repositories. */
export function buildTestApp(overrides: TestAppOverrides = {}): Promise<FastifyInstance> {
  const { env, ...rest } = overrides;
  return buildApp({
    checkDatabase: dbUp,
    repositories: createTestRepositories(),
    passwordHasher: testHasher,
    appInfo: { name: 'alimentos-backend', version: '0.0.0-test' },
    logger: false,
    ...rest,
    env: {
      NODE_ENV: 'test',
      CORS_ORIGINS: [ALLOWED_ORIGIN],
      JWT_ACCESS_SECRET: TEST_JWT_SECRET,
      ACCESS_TOKEN_TTL: '15m',
      REFRESH_TOKEN_TTL_DAYS: 7,
      LOGIN_MAX_ATTEMPTS: 5,
      LOGIN_WINDOW_MINUTES: 15,
      APP_TIMEZONE: 'America/Bogota',
      ...env,
    },
  });
}
