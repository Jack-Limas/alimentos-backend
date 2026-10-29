import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, OPERATOR, bearer, buildAuthTestApp, login } from './helpers/auth-fixtures.js';
import { renderRoleMatrix, ROLE_MATRIX, urlOf, type Who } from './role-matrix.cases.js';

let app: FastifyInstance;
const tokens: Partial<Record<Who, string>> = {};

beforeAll(async () => {
  ({ app } = await buildAuthTestApp());
  for (const [who, user] of [
    ['ADMIN', ADMIN],
    ['OPERATOR', OPERATOR],
  ] as const) {
    tokens[who] = (await login(app, user)).json<{ accessToken: string }>().accessToken;
  }
});

afterAll(async () => {
  await app.close();
});

/**
 * Every "METHOD path" Fastify registered, rebuilt from printRoutes: a radix
 * tree where each child's text is appended to its parent's (4 characters of
 * indentation per level). A prefix plus '/' is registered with and without the
 * trailing slash, so both count as one route. HEAD and OPTIONS are implicit.
 */
function registeredRoutes(): string[] {
  const stack: string[] = [];
  const routes = new Set<string>();
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const match = /^([│ ]*)[├└]── (\S+)(?: \(([^)]+)\))?$/.exec(line);
    if (!match?.[2]) continue;
    const depth = (match[1] ?? '').length / 4;
    stack.length = depth;
    const path = (stack[depth - 1] ?? '') + match[2];
    stack[depth] = path;
    const normalized = path.length > 1 ? path.replace(/\/$/, '') : path;
    for (const method of (match[3] ?? '').split(',').map((m) => m.trim())) {
      if (method && method !== 'HEAD' && method !== 'OPTIONS')
        routes.add(`${method} ${normalized}`);
    }
  }
  return [...routes].filter((route) => !route.endsWith('*'));
}

// The report case starts the worker threads (cold under a loaded test run).
describe('role matrix', { timeout: 30_000 }, () => {
  it('covers every registered route exactly once', () => {
    const inMatrix = ROLE_MATRIX.map((entry) => `${entry.method} ${entry.route}`);
    expect(new Set(inMatrix).size).toBe(inMatrix.length);
    expect([...registeredRoutes()].sort()).toEqual([...inMatrix].sort());
  });

  describe.each(ROLE_MATRIX)('$method $route', (entry) => {
    it.each(['anonymous', 'OPERATOR', 'ADMIN'] as const)('%s', async (who) => {
      const token = tokens[who as Exclude<Who, 'anonymous'>];
      const res = await app.inject({
        method: entry.method,
        url: urlOf(entry),
        headers: token ? bearer(token) : {},
        ...(entry.payload ? { payload: entry.payload } : {}),
      });
      expect(res.statusCode, res.body.slice(0, 200)).toBe(entry.expected[who]);
    });
  });

  it('docs/role-matrix.md is generated from this table', () => {
    const doc = readFileSync(join(process.cwd(), 'docs/role-matrix.md'), 'utf8');
    expect(doc.replace(/\r\n/g, '\n')).toBe(renderRoleMatrix());
  });
});
