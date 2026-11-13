import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OPERATOR,
  addUser,
  bearer,
  buildAuthTestApp,
  login,
  refresh,
  refreshCookieValue,
} from './helpers/auth-fixtures.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const NEW_PASSWORD = 'Operador-Nuevo-9';

function changePassword(
  app: FastifyInstance,
  session: LightMyRequestResponse,
  payload: Record<string, unknown>,
  ip = '203.0.113.10',
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/change-password',
    headers: {
      ...bearer(session.json<{ accessToken: string }>().accessToken),
      'x-forwarded-for': ip,
    },
    cookies: { refresh_token: refreshCookieValue(session) },
    payload,
  });
}

describe('POST /api/v1/auth/change-password', () => {
  it('a wrong current password is 401 INVALID_CREDENTIALS and changes nothing', async () => {
    const built = await buildAuthTestApp();
    app = built.app;
    const session = await login(app, OPERATOR);
    const res = await changePassword(app, session, {
      currentPassword: 'No-Es-La-Mia-1',
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
    expect((await login(app, OPERATOR)).statusCode).toBe(200);
    // The session making the request is still valid.
    expect((await refresh(app, refreshCookieValue(session))).statusCode).toBe(200);
  });

  it('succeeds, keeps the current session and revokes the other ones', async () => {
    const built = await buildAuthTestApp();
    app = built.app;
    const phone = await login(app, OPERATOR, '198.51.100.7');
    const laptop = await login(app, OPERATOR);

    const res = await changePassword(app, laptop, {
      currentPassword: OPERATOR.password,
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      data: { email: OPERATOR.email, mustChangePassword: false, isProtected: false },
    });

    expect((await refresh(app, refreshCookieValue(laptop))).statusCode).toBe(200);
    expect((await refresh(app, refreshCookieValue(phone))).statusCode).toBe(401);
    expect((await login(app, OPERATOR)).statusCode).toBe(401);
    expect((await login(app, { ...OPERATOR, password: NEW_PASSWORD })).statusCode).toBe(200);

    const audit = built.repositories.auditLogs.entries.find((e) => e.action === 'PASSWORD_CHANGED');
    expect(audit).toMatchObject({ userId: built.operator.id, entityId: built.operator.id });
    expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);
  });

  it('a demo (protected) account gets 403 PROTECTED_ACCOUNT and keeps its public password', async () => {
    const built = await buildAuthTestApp();
    app = built.app;
    const demo = {
      email: 'demo.operador@alimentaiq.test',
      password: 'Demo-Publica-2026',
      role: 'OPERATOR' as const,
    };
    await addUser(built.repositories, { ...demo, name: 'Operador Demo', isProtected: true });
    const session = await login(app, demo);
    expect(session.json()).toMatchObject({ user: { isProtected: true } });

    const res = await changePassword(app, session, {
      currentPassword: demo.password,
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'PROTECTED_ACCOUNT' } });
    expect((await login(app, demo)).statusCode).toBe(200);
  });

  it('applies the new password policy and refuses the same password', async () => {
    const built = await buildAuthTestApp();
    app = built.app;
    const session = await login(app, OPERATOR);
    for (const newPassword of ['Corta-1', 'sin-numeros-aqui', OPERATOR.password]) {
      const res = await changePassword(app, session, {
        currentPassword: OPERATOR.password,
        newPassword,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
  });

  it('has the login attempt limit: after 5 wrong current passwords, 429 with Retry-After', async () => {
    const built = await buildAuthTestApp();
    app = built.app;
    const session = await login(app, OPERATOR, '192.0.2.44');
    const wrong = { currentPassword: 'No-Es-La-Mia-1', newPassword: NEW_PASSWORD };
    for (let i = 0; i < 5; i += 1) {
      expect((await changePassword(app, session, wrong, '192.0.2.44')).statusCode).toBe(401);
    }
    const blocked = await changePassword(
      app,
      session,
      { currentPassword: OPERATOR.password, newPassword: NEW_PASSWORD },
      '192.0.2.44',
    );
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    // The same counter as /auth/login for that email and IP.
    const loginBlocked = await login(app, OPERATOR, '192.0.2.44');
    expect(loginBlocked.statusCode).toBe(429);
  });

  it('requires a session', async () => {
    const built = await buildAuthTestApp();
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      payload: { currentPassword: OPERATOR.password, newPassword: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
  });
});
