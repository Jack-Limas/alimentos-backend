import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  OPERATOR,
  addUser,
  bearer,
  buildAuthTestApp,
  login,
  refresh,
  refreshCookieValue,
} from './helpers/auth-fixtures.js';
import { createTestRepositories, testHasher } from './helpers/test-app.js';
import { createUserService } from '../src/modules/users/index.js';

const TEMPORARY = 'Temporal-2026';
const NEW_USER = {
  email: 'Nuevo.Operador@AlimentaIQ.test',
  name: 'Nuevo Operador',
  role: 'OPERATOR',
  temporaryPassword: TEMPORARY,
};

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup(env: Record<string, unknown> = {}) {
  const built = await buildAuthTestApp({ env });
  app = built.app;
  const adminToken = (await login(built.app, ADMIN)).json<{ accessToken: string }>().accessToken;
  const operatorToken = (await login(built.app, OPERATOR)).json<{ accessToken: string }>()
    .accessToken;
  return { ...built, app: built.app, adminToken, operatorToken };
}

function createUser(app: FastifyInstance, token: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/v1/users', headers: bearer(token), payload });
}

function patchUser(app: FastifyInstance, token: string, id: string, payload: object) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/users/${id}`,
    headers: bearer(token),
    payload,
  });
}

function resetPassword(app: FastifyInstance, token: string, id: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/users/${id}/reset-password`,
    headers: bearer(token),
    payload: { temporaryPassword: 'Otra-Temporal-1' },
  });
}

/** Every string in a JSON body, recursively: no value may look like a bcrypt hash. */
function noPasswordHash(body: unknown): void {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/passwordHash/);
  expect(text).not.toMatch(/\$2[aby]\$/);
}

describe('POST /api/v1/users', () => {
  it('creates an unprotected user with a pending password change (201) and audits it', async () => {
    const { app, adminToken, repositories, admin } = await setup();
    const res = await createUser(app, adminToken, NEW_USER);

    expect(res.statusCode).toBe(201);
    const { data } = res.json<{ data: Record<string, unknown> }>();
    expect(data).toMatchObject({
      email: 'nuevo.operador@alimentaiq.test',
      name: 'Nuevo Operador',
      role: 'OPERATOR',
      active: true,
      isProtected: false,
      mustChangePassword: true,
    });
    expect(Object.keys(data).sort()).toEqual(
      [
        'active',
        'createdAt',
        'email',
        'id',
        'isProtected',
        'mustChangePassword',
        'name',
        'role',
      ].sort(),
    );
    noPasswordHash(res.json());
    const audit = repositories.auditLogs.entries.find((e) => e.action === 'USER_CREATED');
    expect(audit).toMatchObject({
      userId: admin.id,
      entityId: data.id,
      metadata: { role: 'OPERATOR' },
    });
    // Neither the email nor the password ever reach the audit log.
    expect(JSON.stringify(audit)).not.toMatch(/nuevo\.operador|Temporal/i);
  });

  it('refuses an email already in use with 409 DUPLICATE, whatever its case', async () => {
    const { app, adminToken } = await setup();
    expect((await createUser(app, adminToken, NEW_USER)).statusCode).toBe(201);
    const again = await createUser(app, adminToken, {
      ...NEW_USER,
      email: 'NUEVO.operador@alimentaiq.test',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      error: { code: 'DUPLICATE', details: { field: 'email' } },
    });
    const seeded = await createUser(app, adminToken, { ...NEW_USER, email: OPERATOR.email });
    expect(seeded.json()).toMatchObject({ error: { code: 'DUPLICATE' } });
  });

  it('stops at MAX_MANAGED_USERS unprotected users with 409 USER_LIMIT_REACHED', async () => {
    const { app, adminToken, repositories } = await setup({ MAX_MANAGED_USERS: 2 });
    // Like production after the migration: the seeded accounts are protected and,
    // like any protected account, never count towards the limit.
    repositories.users.users.forEach((user) => {
      user.isProtected = true;
    });
    await addUser(repositories, {
      email: 'demo@alimentaiq.test',
      password: 'Demo-Pass-123',
      role: 'OPERATOR',
      isProtected: true,
    });
    for (const n of [1, 2]) {
      const res = await createUser(app, adminToken, {
        ...NEW_USER,
        email: `op${String(n)}@x.test`,
      });
      expect(res.statusCode).toBe(201);
    }
    const third = await createUser(app, adminToken, { ...NEW_USER, email: 'op3@x.test' });
    expect(third.statusCode).toBe(409);
    expect(third.json()).toMatchObject({
      error: { code: 'USER_LIMIT_REACHED', details: { limit: 2 } },
    });
  });

  it('validates the temporary password: 10+ characters with letters and numbers', async () => {
    const { app, adminToken } = await setup();
    for (const temporaryPassword of ['Corta-1', 'solo-letras-largas', '1234567890123']) {
      const res = await createUser(app, adminToken, { ...NEW_USER, temporaryPassword });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
  });

  it('is ADMIN only: an OPERATOR gets 403 and nothing is created', async () => {
    const { app, operatorToken, repositories } = await setup();
    const res = await createUser(app, operatorToken, NEW_USER);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(repositories.users.users.size).toBe(2);
  });
});

describe('the created user signs in with the temporary password', () => {
  it('gets mustChangePassword true and can only use /auth/me and /auth/change-password', async () => {
    const { app, adminToken } = await setup();
    await createUser(app, adminToken, NEW_USER);

    const res = await login(app, { email: NEW_USER.email, password: TEMPORARY });
    expect(res.statusCode).toBe(200);
    const { accessToken, user } = res.json<{
      accessToken: string;
      user: { mustChangePassword: boolean };
    }>();
    expect(user.mustChangePassword).toBe(true);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(accessToken),
    });
    expect(me.json()).toMatchObject({ data: { mustChangePassword: true, isProtected: false } });

    // The real rule is the server's: everything else waits for the new password.
    const orders = await app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      headers: bearer(accessToken),
    });
    expect(orders.statusCode).toBe(403);
    expect(orders.json()).toMatchObject({ error: { code: 'PASSWORD_CHANGE_REQUIRED' } });

    const changed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: bearer(accessToken),
      cookies: { refresh_token: refreshCookieValue(res) },
      payload: { currentPassword: TEMPORARY, newPassword: 'Mi-Clave-Propia-7' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ data: { mustChangePassword: false } });

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      headers: bearer(accessToken),
    });
    expect(after.statusCode).toBe(200);
  });
});

describe('GET /api/v1/users', () => {
  it('lists with pagination and filters, protected accounts first, never a password hash', async () => {
    const { app, adminToken, repositories } = await setup();
    repositories.users.users.forEach((user) => {
      if (user.email === ADMIN.email) user.isProtected = true;
    });
    await createUser(app, adminToken, NEW_USER);
    await createUser(app, adminToken, {
      ...NEW_USER,
      email: 'jefa@x.test',
      name: 'Jefa de Bodega',
      role: 'ADMIN',
    });

    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: bearer(adminToken),
    });
    expect(all.statusCode).toBe(200);
    const body = all.json<{ data: { email: string; isProtected: boolean }[]; meta: object }>();
    expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 4 });
    expect(body.data[0]).toMatchObject({ email: ADMIN.email, isProtected: true });
    noPasswordHash(body);

    const admins = await app.inject({
      method: 'GET',
      url: '/api/v1/users?role=ADMIN&active=true&search=bodega',
      headers: bearer(adminToken),
    });
    expect(admins.json<{ data: { email: string }[] }>().data.map((u) => u.email)).toEqual([
      'jefa@x.test',
    ]);

    const page = await app.inject({
      method: 'GET',
      url: '/api/v1/users?page=2&pageSize=3',
      headers: bearer(adminToken),
    });
    expect(page.json()).toMatchObject({ meta: { page: 2, pageSize: 3, total: 4 } });
    expect(page.json<{ data: unknown[] }>().data).toHaveLength(1);

    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/users?active=maybe',
      headers: bearer(adminToken),
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('PATCH /api/v1/users/:id', () => {
  async function withCreatedOperator() {
    const ctx = await setup();
    const created = await createUser(ctx.app, ctx.adminToken, NEW_USER);
    const id = created.json<{ data: { id: string } }>().data.id;
    // The user signs in (and changes the temporary password) to have a live session.
    const first = await login(ctx.app, { email: NEW_USER.email, password: TEMPORARY });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: bearer(first.json<{ accessToken: string }>().accessToken),
      cookies: { refresh_token: refreshCookieValue(first) },
      payload: { currentPassword: TEMPORARY, newPassword: 'Mi-Clave-Propia-7' },
    });
    const session = await login(ctx.app, { email: NEW_USER.email, password: 'Mi-Clave-Propia-7' });
    return {
      ...ctx,
      id,
      userToken: session.json<{ accessToken: string }>().accessToken,
      userCookie: refreshCookieValue(session),
    };
  }

  it('renames without ending the sessions', async () => {
    const { app, adminToken, id, userToken, userCookie } = await withCreatedOperator();
    const res = await patchUser(app, adminToken, id, { name: '  Operadora Turno Noche ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: { name: 'Operadora Turno Noche' } });
    expect((await refresh(app, userCookie)).statusCode).toBe(200);
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(userToken),
    });
    expect(me.statusCode).toBe(200);
  });

  it('a new role revokes every session: refresh and the old access token stop working', async () => {
    const { app, adminToken, id, userToken, userCookie, repositories } =
      await withCreatedOperator();
    const res = await patchUser(app, adminToken, id, { role: 'ADMIN' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: { role: 'ADMIN' } });

    expect((await refresh(app, userCookie)).statusCode).toBe(401);
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(userToken),
    });
    expect(me.statusCode).toBe(401);
    const live = [...repositories.refreshTokens.tokens.values()].filter(
      (t) => t.userId === id && t.revokedAt === null,
    );
    expect(live).toHaveLength(0);
    const audit = repositories.auditLogs.entries.find((e) => e.action === 'USER_UPDATED');
    expect(audit?.metadata).toMatchObject({ fields: ['role'], role: 'ADMIN' });
  });

  it('deactivating revokes every session and the user can no longer sign in', async () => {
    const { app, adminToken, id, userToken, userCookie } = await withCreatedOperator();
    const res = await patchUser(app, adminToken, id, { active: false });
    expect(res.json()).toMatchObject({ data: { active: false } });

    expect((await refresh(app, userCookie)).statusCode).toBe(401);
    const orders = await app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      headers: bearer(userToken),
    });
    expect(orders.statusCode).toBe(401);
    const again = await login(app, { email: NEW_USER.email, password: 'Mi-Clave-Propia-7' });
    expect(again.statusCode).toBe(401);

    // Reactivated: can sign in again.
    await patchUser(app, adminToken, id, { active: true });
    expect(
      (await login(app, { email: NEW_USER.email, password: 'Mi-Clave-Propia-7' })).statusCode,
    ).toBe(200);
  });

  it('a protected account gives 403 PROTECTED_ACCOUNT on edit, deactivate and reset', async () => {
    const { app, adminToken, repositories } = await setup();
    const demo = await addUser(repositories, {
      email: 'demo.operador@alimentaiq.test',
      password: 'Demo-Publica-2026',
      role: 'OPERATOR',
      name: 'Operador Demo',
      isProtected: true,
    });
    for (const res of [
      await patchUser(app, adminToken, demo.id, { name: 'Otro nombre' }),
      await patchUser(app, adminToken, demo.id, { active: false }),
      await patchUser(app, adminToken, demo.id, { role: 'ADMIN' }),
      await resetPassword(app, adminToken, demo.id),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'PROTECTED_ACCOUNT' } });
    }
    expect(repositories.users.users.get(demo.id)).toMatchObject({
      name: 'Operador Demo',
      active: true,
      role: 'OPERATOR',
    });
    expect(await login(app, { email: demo.email, password: 'Demo-Publica-2026' })).toHaveProperty(
      'statusCode',
      200,
    );
  });

  it('an ADMIN cannot deactivate or demote itself (409 SELF_LOCKOUT)', async () => {
    const { app, adminToken, admin } = await setup();
    for (const patch of [{ active: false }, { role: 'OPERATOR' }]) {
      const res = await patchUser(app, adminToken, admin.id, patch);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: 'SELF_LOCKOUT' } });
    }
    const reset = await resetPassword(app, adminToken, admin.id);
    expect(reset.json()).toMatchObject({ error: { code: 'SELF_LOCKOUT' } });
    // Its own name is fine.
    expect((await patchUser(app, adminToken, admin.id, { name: 'Admin' })).statusCode).toBe(200);
  });

  it('never leaves zero active ADMINs (409 LAST_ADMIN), writing nothing', async () => {
    // Through the API this is the race of two ADMINs deactivating each other at once
    // (each request already authenticated); the service sees it as an actor whose own
    // account is no longer active.
    const repositories = createTestRepositories();
    const actor = await addUser(repositories, { ...ADMIN, active: false });
    const last = await addUser(repositories, { ...ADMIN, email: 'jefa@x.test' });
    const service = createUserService({
      users: repositories.users,
      refreshTokens: repositories.refreshTokens,
      hasher: testHasher,
      clock: () => new Date(),
      maxManagedUsers: 30,
    });
    const actorRef = { userId: actor.id, ip: '203.0.113.10' };

    for (const patch of [{ active: false }, { role: 'OPERATOR' as const }]) {
      await expect(service.update(last.id, patch, actorRef)).rejects.toMatchObject({
        statusCode: 409,
        code: 'LAST_ADMIN',
      });
    }
    expect(repositories.users.users.get(last.id)).toMatchObject({ role: 'ADMIN', active: true });
    expect(repositories.auditLogs.entries.filter((e) => e.action === 'USER_UPDATED')).toEqual([]);
  });

  it('the Prisma repository checks the limit and the last ADMIN under one advisory lock', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/modules/users/user.prisma-repository.ts'),
      'utf8',
    );
    const create = source.slice(source.indexOf('async createManaged('));
    expect(create.indexOf('await lock(tx)')).toBeLessThan(
      create.indexOf('isProtected: false } })'),
    );
    const update = source.slice(source.indexOf('async updateManaged('));
    expect(update.indexOf('await lock(tx)')).toBeLessThan(
      update.indexOf("role: 'ADMIN', active: true"),
    );
    expect(source).toContain('pg_advisory_xact_lock(${USER_WRITE_LOCK_KEY})');
  });

  it('answers 404 for an unknown id and 400 for an empty or unknown patch', async () => {
    const { app, adminToken, admin } = await setup();
    const missing = await patchUser(app, adminToken, '00000000-0000-4000-8000-000000000000', {
      name: 'X',
    });
    expect(missing.statusCode).toBe(404);
    expect((await patchUser(app, adminToken, admin.id, {})).statusCode).toBe(400);
    expect((await patchUser(app, adminToken, admin.id, { email: 'a@b.co' })).statusCode).toBe(400);
  });
});

describe('POST /api/v1/users/:id/reset-password', () => {
  it('sets a new temporary password, mustChangePassword and ends the sessions', async () => {
    const { app, adminToken, repositories } = await setup();
    const created = await createUser(app, adminToken, NEW_USER);
    const id = created.json<{ data: { id: string } }>().data.id;
    const session = await login(app, { email: NEW_USER.email, password: TEMPORARY });

    const res = await resetPassword(app, adminToken, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: { mustChangePassword: true } });
    noPasswordHash(res.json());

    expect((await refresh(app, refreshCookieValue(session))).statusCode).toBe(401);
    expect((await login(app, { email: NEW_USER.email, password: TEMPORARY })).statusCode).toBe(401);
    const fresh = await login(app, { email: NEW_USER.email, password: 'Otra-Temporal-1' });
    expect(fresh.json()).toMatchObject({ user: { mustChangePassword: true } });
    expect(repositories.auditLogs.entries.some((e) => e.action === 'USER_PASSWORD_RESET')).toBe(
      true,
    );
  });
});
