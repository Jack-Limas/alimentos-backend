import { describe, expect, it } from 'vitest';
import { ADMIN, OPERATOR, bearer, buildAuthTestApp, login } from './helpers/auth-fixtures.js';

async function accessTokenFor(
  app: Awaited<ReturnType<typeof buildAuthTestApp>>['app'],
  user: { email: string; password: string },
): Promise<string> {
  return (await login(app, user)).json<{ accessToken: string }>().accessToken;
}

describe('GET /api/v1/audit-logs', () => {
  it('returns 401 without a token', async () => {
    const { app } = await buildAuthTestApp();

    const res = await app.inject({ method: 'GET', url: '/api/v1/audit-logs' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 403 FORBIDDEN for an OPERATOR', async () => {
    const { app } = await buildAuthTestApp();
    const token = await accessTokenFor(app, OPERATOR);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs',
      headers: bearer(token),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
    await app.close();
  });

  it('returns 200 with the paginated contract format for an ADMIN', async () => {
    const { app, admin } = await buildAuthTestApp();
    const token = await accessTokenFor(app, ADMIN);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs',
      headers: bearer(token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { action: string; userId: string }[]; meta: unknown }>();
    expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    expect(body.data[0]).toMatchObject({ action: 'LOGIN_SUCCESS', userId: admin.id });
    await app.close();
  });

  it('filters by action and userId and paginates', async () => {
    const { app, operator } = await buildAuthTestApp();
    await accessTokenFor(app, OPERATOR);
    await accessTokenFor(app, OPERATOR);
    const token = await accessTokenFor(app, ADMIN);

    const byUser = await app.inject({
      method: 'GET',
      url: `/api/v1/audit-logs?action=LOGIN_SUCCESS&userId=${operator.id}&page=2&pageSize=1`,
      headers: bearer(token),
    });

    expect(byUser.statusCode).toBe(200);
    const body = byUser.json<{ data: { userId: string }[]; meta: unknown }>();
    expect(body.meta).toEqual({ page: 2, pageSize: 1, total: 2 });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.userId).toBe(operator.id);
    await app.close();
  });

  it('rejects invalid filters with 400', async () => {
    const { app } = await buildAuthTestApp();
    const token = await accessTokenFor(app, ADMIN);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs?userId=not-a-uuid&pageSize=1000',
      headers: bearer(token),
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
