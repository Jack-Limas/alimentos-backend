import { randomUUID } from 'node:crypto';
import type { Role } from '@prisma/client';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { UserRecord } from '../../src/modules/users/user.repository.js';
import {
  buildTestApp,
  createTestRepositories,
  testHasher,
  type TestRepositories,
} from './test-app.js';

export const ADMIN = {
  email: 'admin@alimentaiq.test',
  password: 'Admin-Pass-123!',
  role: 'ADMIN' as Role,
};
export const OPERATOR = {
  email: 'operator@alimentaiq.test',
  password: 'Operator-Pass-123!',
  role: 'OPERATOR' as Role,
};

export async function addUser(
  repositories: TestRepositories,
  input: { email: string; password: string; role: Role; active?: boolean; name?: string },
): Promise<UserRecord> {
  const user: UserRecord = {
    id: randomUUID(),
    email: input.email,
    name: input.name ?? input.email.split('@')[0] ?? 'user',
    passwordHash: await testHasher.hash(input.password),
    role: input.role,
    active: input.active ?? true,
  };
  repositories.users.users.set(user.id, user);
  return user;
}

/** App with an active ADMIN and OPERATOR already stored. */
export async function buildAuthTestApp(overrides: Parameters<typeof buildTestApp>[0] = {}) {
  const repositories = createTestRepositories();
  const admin = await addUser(repositories, ADMIN);
  const operator = await addUser(repositories, OPERATOR);
  const app = await buildTestApp({ repositories, ...overrides });
  return { app, repositories, admin, operator };
}

export function login(
  app: FastifyInstance,
  credentials: { email: string; password: string },
  ip = '203.0.113.10',
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'x-forwarded-for': ip },
    payload: credentials,
  });
}

/** Raw Set-Cookie header for the refresh cookie. */
export function refreshSetCookie(res: LightMyRequestResponse): string {
  const header = res.headers['set-cookie'];
  const all = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = all.find((value) => value.startsWith('refresh_token='));
  if (!cookie) {
    throw new Error('refresh_token cookie not set');
  }
  return cookie;
}

/** Value of the refresh cookie, ready to send back as `refresh_token=<value>`. */
export function refreshCookieValue(res: LightMyRequestResponse): string {
  const pair = refreshSetCookie(res).split(';')[0] ?? '';
  return pair.slice('refresh_token='.length);
}

export function refresh(app: FastifyInstance, token: string): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    cookies: { refresh_token: token },
  });
}

export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
