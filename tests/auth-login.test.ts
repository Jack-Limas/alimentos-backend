import { describe, expect, it } from 'vitest';
import {
  ADMIN,
  OPERATOR,
  addUser,
  buildAuthTestApp,
  login,
  refreshCookieValue,
  refreshSetCookie,
} from './helpers/auth-fixtures.js';

const INVALID = { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' };

describe('POST /api/v1/auth/login', () => {
  it('returns 200 with accessToken and user, and sets a secure refresh cookie', async () => {
    const { app, admin } = await buildAuthTestApp();

    const res = await login(app, ADMIN);

    expect(res.statusCode).toBe(200);
    const body = res.json<{ accessToken: string; user: unknown }>();
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.user).toEqual({
      id: admin.id,
      email: ADMIN.email,
      name: admin.name,
      role: 'ADMIN',
    });

    const cookie = refreshSetCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=None/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/Max-Age=604800/);

    // The refresh token never travels in the body.
    expect(res.body).not.toContain(refreshCookieValue(res));
    expect(Object.keys(body)).toEqual(['accessToken', 'user']);
    await app.close();
  });

  it('normalizes the email before looking up the user', async () => {
    const { app } = await buildAuthTestApp();

    const res = await login(app, { email: '  ADMIN@AlimentaIQ.test ', password: ADMIN.password });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('answers wrong password, unknown email and inactive user with the same 401', async () => {
    const { app, repositories } = await buildAuthTestApp();
    await addUser(repositories, {
      email: 'inactive@alimentaiq.test',
      password: 'Inactive-Pass-123!',
      role: 'OPERATOR',
      active: false,
    });

    const wrongPassword = await login(app, { email: ADMIN.email, password: 'nope' });
    const unknownEmail = await login(app, { email: 'ghost@alimentaiq.test', password: 'x' });
    const inactive = await login(app, {
      email: 'inactive@alimentaiq.test',
      password: 'Inactive-Pass-123!',
    });

    for (const res of [wrongPassword, unknownEmail, inactive]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: { ...INVALID, details: {} } });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    await app.close();
  });

  it('records every login attempt and audits successful logins', async () => {
    const { app, repositories, admin } = await buildAuthTestApp();

    await login(app, { email: ADMIN.email, password: 'wrong' });
    await login(app, ADMIN);

    expect(repositories.loginAttempts.attempts.map((a) => a.success)).toEqual([false, true]);
    expect(repositories.auditLogs.entries).toEqual([
      expect.objectContaining({ action: 'LOGIN_SUCCESS', userId: admin.id, ip: '203.0.113.10' }),
    ]);
    await app.close();
  });

  it('rejects a malformed body with 400 VALIDATION_ERROR', async () => {
    const { app } = await buildAuthTestApp();

    const res = await login(app, { email: 'not-an-email', password: '' });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    await app.close();
  });
});

describe('login attempt limit', () => {
  it('blocks the 6th attempt in the window with 429 and Retry-After, and audits it', async () => {
    const { app, repositories } = await buildAuthTestApp();

    for (let i = 0; i < 5; i += 1) {
      const res = await login(app, { email: ADMIN.email, password: `wrong-${i}` });
      expect(res.statusCode).toBe(401);
    }

    // Even the right password is refused while blocked.
    const blocked = await login(app, ADMIN);

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('TOO_MANY_REQUESTS');
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    expect(repositories.auditLogs.entries.map((e) => e.action)).toContain('LOGIN_BLOCKED');
    await app.close();
  });

  it('still lets a different email log in from the same IP', async () => {
    const { app } = await buildAuthTestApp();
    for (let i = 0; i < 5; i += 1) {
      await login(app, { email: ADMIN.email, password: `wrong-${i}` });
    }

    const res = await login(app, OPERATOR);

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('counts attempts per IP: the same email from another IP is not blocked', async () => {
    const { app } = await buildAuthTestApp();
    for (let i = 0; i < 5; i += 1) {
      await login(app, { email: ADMIN.email, password: `wrong-${i}` }, '198.51.100.1');
    }

    const res = await login(app, ADMIN, '198.51.100.2');

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('unblocks once the window has passed', async () => {
    let now = new Date('2026-10-26T12:00:00Z');
    const { app } = await buildAuthTestApp({ clock: () => now });
    for (let i = 0; i < 5; i += 1) {
      await login(app, { email: ADMIN.email, password: `wrong-${i}` });
    }
    expect((await login(app, ADMIN)).statusCode).toBe(429);

    now = new Date('2026-10-26T12:15:01Z');

    expect((await login(app, ADMIN)).statusCode).toBe(200);
    await app.close();
  });
});
