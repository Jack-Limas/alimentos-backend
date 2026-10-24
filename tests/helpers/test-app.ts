import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../../src/app.js';

export const ALLOWED_ORIGIN = 'http://localhost:3000';

export const dbUp = (): Promise<void> => Promise.resolve();
export const dbDown = (): Promise<void> => Promise.reject(new Error('connection refused'));

type TestAppOverrides = Partial<Omit<AppDeps, 'env'>> & { env?: Partial<AppDeps['env']> };

/** Builds the app with a simulated database; never touches a real one. */
export function buildTestApp(overrides: TestAppOverrides = {}): Promise<FastifyInstance> {
  const { env, ...rest } = overrides;
  return buildApp({
    checkDatabase: dbUp,
    appInfo: { name: 'alimentos-backend', version: '0.0.0-test' },
    logger: false,
    ...rest,
    env: { NODE_ENV: 'test', CORS_ORIGINS: [ALLOWED_ORIGIN], ...env },
  });
}
