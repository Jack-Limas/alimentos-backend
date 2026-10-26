import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../src/shared/errors/index.js';
import { buildTestApp } from './helpers/test-app.js';

async function buildAppWithFailingRoutes(nodeEnv: 'test' | 'production' = 'test') {
  const app = await buildTestApp({ env: { NODE_ENV: nodeEnv } });
  app.get('/app-error', () => {
    throw new AppError(409, 'DUPLICATE', 'Email already registered', { field: 'email' });
  });
  app.get('/rate-limited', () => {
    throw new AppError(429, 'TOO_MANY_REQUESTS', 'Slow down', {}, { 'Retry-After': '42' });
  });
  app.get('/zod-error', () => {
    z.object({ quantity: z.number().positive() }).parse({ quantity: -1 });
  });
  app.get('/crash', () => {
    throw new Error('database password leaked in message');
  });
  return app;
}

describe('error handler', () => {
  it('sends the headers carried by AppError', async () => {
    const app = await buildAppWithFailingRoutes();

    const res = await app.inject({ method: 'GET', url: '/rate-limited' });

    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('42');
    expect(res.json<{ error: { code: string } }>().error.code).toBe('TOO_MANY_REQUESTS');
    await app.close();
  });

  it('serializes AppError with its status, code and details', async () => {
    const app = await buildAppWithFailingRoutes();

    const res = await app.inject({ method: 'GET', url: '/app-error' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: {
        code: 'DUPLICATE',
        message: 'Email already registered',
        details: { field: 'email' },
      },
    });
    await app.close();
  });

  it('maps Zod errors to 400 VALIDATION_ERROR with issues', async () => {
    const app = await buildAppWithFailingRoutes();

    const res = await app.inject({ method: 'GET', url: '/zod-error' });
    const body = res.json<{ error: { code: string; details: { issues: { path: string }[] } } }>();

    expect(res.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.issues[0]?.path).toBe('quantity');
    await app.close();
  });

  it('hides the message and stack of unexpected errors in production', async () => {
    const app = await buildAppWithFailingRoutes('production');

    const res = await app.inject({ method: 'GET', url: '/crash' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} },
    });
    expect(res.body).not.toContain('password');
    await app.close();
  });

  it('includes the stack of unexpected errors outside production', async () => {
    const app = await buildAppWithFailingRoutes('test');

    const res = await app.inject({ method: 'GET', url: '/crash' });
    const body = res.json<{ error: { details: { stack?: string } } }>();

    expect(res.statusCode).toBe(500);
    expect(body.error.details.stack).toContain('Error');
    await app.close();
  });
});
