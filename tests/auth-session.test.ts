import { describe, expect, it } from 'vitest';
import {
  ADMIN,
  bearer,
  buildAuthTestApp,
  login,
  refresh,
  refreshCookieValue,
  refreshSetCookie,
} from './helpers/auth-fixtures.js';

describe('POST /api/v1/auth/logout', () => {
  it('returns 204, clears the cookie with the same attributes and audits LOGOUT', async () => {
    const { app, repositories, admin } = await buildAuthTestApp();
    const token = refreshCookieValue(await login(app, ADMIN));

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { refresh_token: token },
    });

    expect(res.statusCode).toBe(204);
    const cleared = refreshSetCookie(res);
    expect(cleared).toMatch(/^refresh_token=;/);
    expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    expect(cleared).toMatch(/Path=\/api\/v1\/auth/);
    expect(cleared).toMatch(/HttpOnly/i);
    expect(cleared).toMatch(/Secure/i);
    expect(cleared).toMatch(/SameSite=None/i);
    expect(repositories.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'LOGOUT', userId: admin.id }),
    );

    // The session is gone: refreshing with the old cookie fails.
    expect((await refresh(app, token)).statusCode).toBe(401);
    await app.close();
  });

  it('returns 204 even without a cookie', async () => {
    const { app } = await buildAuthTestApp();

    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });

    expect(res.statusCode).toBe(204);
    await app.close();
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns 401 UNAUTHENTICATED without a token', async () => {
    const { app } = await buildAuthTestApp();

    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('UNAUTHENTICATED');
    await app.close();
  });

  it('returns 401 UNAUTHENTICATED with a tampered token', async () => {
    const { app } = await buildAuthTestApp();
    const { accessToken } = (await login(app, ADMIN)).json<{ accessToken: string }>();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(`${accessToken.slice(0, -2)}xx`),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('UNAUTHENTICATED');
    await app.close();
  });

  it('returns 401 TOKEN_EXPIRED with an expired token', async () => {
    const { app, admin } = await buildAuthTestApp();
    const issuedAt = Math.floor(Date.now() / 1000) - 3600;
    // Not a literal, so the extra `iat` claim passes the payload type check.
    const claims = { sub: admin.id, role: 'ADMIN' as const, iat: issuedAt };
    const expired = app.jwt.sign(claims, { expiresIn: '1m' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(expired),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('TOKEN_EXPIRED');
    await app.close();
  });

  it('returns 200 with the user read from the database', async () => {
    const { app, admin } = await buildAuthTestApp();
    const { accessToken } = (await login(app, ADMIN)).json<{ accessToken: string }>();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(accessToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: { id: admin.id, email: ADMIN.email, name: admin.name, role: 'ADMIN' },
    });
    await app.close();
  });

  it('returns 401 when the user was deactivated after login', async () => {
    const { app, repositories, admin } = await buildAuthTestApp();
    const { accessToken } = (await login(app, ADMIN)).json<{ accessToken: string }>();
    repositories.users.users.set(admin.id, { ...admin, active: false });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(accessToken),
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
