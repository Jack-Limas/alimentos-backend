import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { ADMIN, OPERATOR, addUser, login } from './helpers/auth-fixtures.js';
import { buildTestApp, createTestRepositories } from './helpers/test-app.js';

/** 12:00 in Bogota on 2026-11-12 (17:00 UTC). */
const NOON = new Date('2026-11-12T17:00:00Z');

async function setup({
  enabled = true,
  anchor = '2026-11-10',
  now = () => NOON,
}: { enabled?: boolean; anchor?: string | null; now?: () => Date } = {}) {
  const repositories = createTestRepositories();
  repositories.demoRefresh.anchor = anchor;
  await addUser(repositories, ADMIN);
  await addUser(repositories, OPERATOR);
  const logs: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      logs.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  const app = await buildTestApp({
    repositories,
    clock: now,
    logger: { level: 'info', stream },
    env: { DEMO_DAILY_REFRESH: enabled },
  });
  const store = repositories.demoRefresh;
  const audits = () =>
    repositories.auditLogs.entries.filter((entry) => entry.action === 'DEMO_REFRESHED');
  return { app, store, logs, audits };
}

describe('DEMO_DAILY_REFRESH', () => {
  it('is off by default (also in tests)', () => {
    expect(
      parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u@h:5432/d',
        DIRECT_URL: 'postgresql://u@h:5432/d',
        CORS_ORIGINS: 'http://localhost:3000',
        JWT_ACCESS_SECRET: 'x'.repeat(40),
      }).DEMO_DAILY_REFRESH,
    ).toBe(false);
  });

  it('two simultaneous logins move the demo once, then not again that day', async () => {
    const { app, store, audits } = await setup();

    const [a, b] = await Promise.all([login(app, ADMIN), login(app, OPERATOR)]);
    await app.demoRefresh.settled();
    await login(app, ADMIN);
    await app.demoRefresh.settled();

    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(store.shifts).toEqual([2]);
    expect(store.anchor).toBe('2026-11-12');
    expect(audits()).toHaveLength(1);
    expect(audits()[0]?.metadata).toMatchObject({ trigger: 'login', days: 2, to: '2026-11-12' });
    await app.close();
  });

  it('even two processes at once move it once: the store lock serializes them', async () => {
    const { app, store } = await setup();
    const other = await buildTestApp({
      repositories: { ...createTestRepositories(), demoRefresh: store },
      clock: () => NOON,
      env: { DEMO_DAILY_REFRESH: true },
    });

    app.demoRefresh.refreshIfDue('login');
    other.demoRefresh.refreshIfDue('public-impact');
    await Promise.all([app.demoRefresh.settled(), other.demoRefresh.settled()]);

    expect(store.shifts).toEqual([2]);
    expect(store.calls).toBe(2);
    await Promise.all([app.close(), other.close()]);
  });

  it('does nothing with DEMO_DAILY_REFRESH=false', async () => {
    const { app, store } = await setup({ enabled: false });

    expect((await login(app, ADMIN)).statusCode).toBe(200);
    await app.demoRefresh.settled();
    await app.inject({ method: 'GET', url: '/api/v1/public/impact' });
    await app.demoRefresh.settled();

    expect(store.calls).toBe(0);
    expect(store.anchor).toBe('2026-11-10');
    await app.close();
  });

  it('without an anchor it stores today and moves nothing', async () => {
    const { app, store, audits } = await setup({ anchor: null });

    await login(app, ADMIN);
    await app.demoRefresh.settled();

    expect(store.anchor).toBe('2026-11-12');
    expect(store.shifts).toEqual([]);
    expect(audits()[0]?.metadata).toMatchObject({ days: 0, anchored: '2026-11-12' });
    await app.close();
  });

  it('a failing refresh never breaks the login: it is only logged', async () => {
    const { app, store, logs } = await setup();
    store.fail = true;

    const res = await login(app, ADMIN);
    await app.demoRefresh.settled();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('accessToken');
    expect(store.shifts).toEqual([]);
    expect(logs.find((line) => line.msg === 'Demo daily refresh failed')).toBeDefined();
    await app.close();
  });

  it('runs after GET /public/impact, never after /health or /health/ready', async () => {
    const { app, store } = await setup();

    for (const url of ['/health', '/api/v1/health', '/api/v1/health/ready']) {
      await app.inject({ method: 'GET', url });
    }
    await app.demoRefresh.settled();
    expect(store.calls).toBe(0);

    expect((await app.inject({ method: 'GET', url: '/api/v1/public/impact' })).statusCode).toBe(
      200,
    );
    await app.demoRefresh.settled();
    expect(store.shifts).toEqual([2]);
    await app.close();
  });

  it('a failed login does not trigger it', async () => {
    const { app, store } = await setup();

    await login(app, { email: ADMIN.email, password: 'wrong-password-123' });
    await app.demoRefresh.settled();

    expect(store.calls).toBe(0);
    await app.close();
  });

  it('counts the business day in Bogota around midnight', async () => {
    let now = new Date('2026-11-13T04:59:00Z'); // 23:59 on 2026-11-12 in Bogota
    const { app, store } = await setup({ anchor: '2026-11-12', now: () => now });

    await login(app, ADMIN);
    await app.demoRefresh.settled();
    expect(store.shifts).toEqual([]);

    now = new Date('2026-11-13T05:00:00Z'); // 00:00 on 2026-11-13 in Bogota
    await login(app, ADMIN);
    await app.demoRefresh.settled();
    expect(store.shifts).toEqual([1]);
    expect(store.anchor).toBe('2026-11-13');
    await app.close();
  });
});
