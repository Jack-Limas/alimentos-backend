import { describe, expect, it } from 'vitest';
import { ADMIN, OPERATOR, bearer, buildAuthTestApp, login } from './helpers/auth-fixtures.js';

const CHAIN = '198.51.100.7, 203.0.113.9';

async function setup(trustProxy?: true | number) {
  const context = await buildAuthTestApp(
    trustProxy === undefined ? {} : { env: { TRUST_PROXY: trustProxy } },
  );
  const tokenOf = async (user: { email: string; password: string }) =>
    (await login(context.app, user)).json<{ accessToken: string }>().accessToken;
  return { ...context, admin: await tokenOf(ADMIN), operator: await tokenOf(OPERATOR) };
}

const networkInfo = (app: Awaited<ReturnType<typeof setup>>['app'], token?: string) =>
  app.inject({
    method: 'GET',
    url: '/api/v1/admin/network-info',
    headers: { 'x-forwarded-for': CHAIN, ...(token ? bearer(token) : {}) },
  });

describe('GET /admin/network-info', () => {
  it('shows the ADMIN the client address the server trusts and audits the read', async () => {
    const { app, admin, repositories } = await setup();
    const res = await networkInfo(app, admin);

    expect(res.statusCode).toBe(200);
    const { data } = res.json<{
      data: { ip: string; ips: string[]; forwardedFor: string; trustProxy: boolean };
    }>();
    // TRUST_PROXY=true: the whole chain is trusted, the client is the leftmost address.
    expect(data.ip).toBe('198.51.100.7');
    expect(data.ips).toEqual(['127.0.0.1', '203.0.113.9', '198.51.100.7']);
    expect(data.forwardedFor).toBe(CHAIN);
    expect(data.trustProxy).toBe(true);
    const row = repositories.auditLogs.entries.find((log) => log.action === 'NETWORK_INFO_VIEWED');
    expect(row).toMatchObject({ entity: 'Network', metadata: { forwardedHops: 2 } });
    await app.close();
  });

  it('with TRUST_PROXY=1 trusts only the closest proxy', async () => {
    const { app, admin } = await setup(1);
    const { data } = (await networkInfo(app, admin)).json<{
      data: { ip: string; trustProxy: number };
    }>();

    expect(data.ip).toBe('203.0.113.9');
    expect(data.trustProxy).toBe(1);
    await app.close();
  });

  it('is ADMIN only', async () => {
    const { app, operator } = await setup();

    expect((await networkInfo(app)).statusCode).toBe(401);
    expect((await networkInfo(app, operator)).statusCode).toBe(403);
    await app.close();
  });
});
