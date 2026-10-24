import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ALLOWED_ORIGIN, buildTestApp, dbDown, dbUp } from './helpers/test-app.js';

describe('health endpoints', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('GET /health returns 200 with service info and no database access', async () => {
    let dbCalls = 0;
    app = await buildTestApp({
      checkDatabase: () => {
        dbCalls += 1;
        return Promise.resolve();
      },
    });

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      service: 'alimentos-backend',
      version: '0.0.0-test',
      uptimeSec: expect.any(Number) as unknown,
    });
    expect(dbCalls).toBe(0);
  });

  it('GET /api/v1/health also answers under the API prefix', async () => {
    app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('ok');
  });

  it('GET /api/v1/health/ready returns 200 when the database is up', async () => {
    app = await buildTestApp({ checkDatabase: dbUp });

    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'up' });
  });

  it('GET /api/v1/health/ready returns 503 when the database is down', async () => {
    app = await buildTestApp({ checkDatabase: dbDown });

    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'down' });
  });

  it('adds the Server-Timing header to responses', async () => {
    app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.headers['server-timing']).toMatch(/^app;dur=\d+(\.\d+)?$/);
  });
});

describe('not found', () => {
  it('returns 404 with the contract error format', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) as unknown, details: {} },
    });
    await app.close();
  });
});

describe('CORS', () => {
  it('echoes an allowed origin with credentials', async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: ALLOWED_ORIGIN },
    });

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    await app.close();
  });

  it('does not send Access-Control-Allow-Origin to a disallowed origin', async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example.com' },
    });

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});
