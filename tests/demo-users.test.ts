import { describe, expect, it } from 'vitest';
import {
  DEMO_NAMES,
  parseDemoUsersConfig,
  seedDemoUsers,
  type DemoUsersConfig,
} from '../src/seed/demo-users.js';
import { SeedConfigError, seedUsers } from '../src/seed/seed-users.js';
import { createInMemoryUserRepository } from './helpers/in-memory-repositories.js';
import { testHasher } from './helpers/test-app.js';

const demoEnv = {
  SEED_DEMO_ADMIN_EMAIL: 'demo.admin@alimentaiq.test',
  SEED_DEMO_ADMIN_PASSWORD: 'demo-admin-1',
  SEED_DEMO_OPERATOR_EMAIL: 'demo.operador@alimentaiq.test',
  SEED_DEMO_OPERATOR_PASSWORD: 'demo-operador',
};
const realConfig = {
  admin: { email: 'admin@alimentaiq.test', password: 'Strong-Admin-Pass-1' },
  operator: { email: 'operator@alimentaiq.test', password: 'operator-pass' },
};

const configOf = (env: Record<string, string>): DemoUsersConfig => {
  const parsed = parseDemoUsersConfig(env);
  if (!parsed.config) throw new Error(parsed.skipped);
  return parsed.config;
};

describe('demo accounts: configuration', () => {
  it('skips the demo accounts with a notice when variables are missing (never fails)', () => {
    expect(parseDemoUsersConfig({})).toEqual({
      config: null,
      skipped: `demo accounts skipped: missing ${Object.keys(demoEnv).join(', ')}`,
    });
    const { SEED_DEMO_OPERATOR_PASSWORD: _omitted, ...partial } = demoEnv;
    expect(parseDemoUsersConfig(partial)).toMatchObject({
      config: null,
      skipped: 'demo accounts skipped: missing SEED_DEMO_OPERATOR_PASSWORD',
    });
  });

  it('accepts a simple public password of 10+ characters (no admin policy)', () => {
    expect(configOf(demoEnv).admin.password).toBe('demo-admin-1');
    expect(() =>
      parseDemoUsersConfig({ ...demoEnv, SEED_DEMO_ADMIN_PASSWORD: 'demo12345' }),
    ).toThrow(/SEED_DEMO_ADMIN_PASSWORD: must be at least 10 characters/);
  });

  it('never takes the email of a real account', () => {
    expect(() =>
      parseDemoUsersConfig({ ...demoEnv, SEED_ADMIN_EMAIL: 'DEMO.Admin@alimentaiq.test' }),
    ).toThrow(SeedConfigError);
    expect(() =>
      parseDemoUsersConfig({ ...demoEnv, SEED_DEMO_OPERATOR_EMAIL: demoEnv.SEED_DEMO_ADMIN_EMAIL }),
    ).toThrow(/must differ from SEED_DEMO_ADMIN_EMAIL/);
  });
});

describe('demo accounts: seed', () => {
  it('creates DEMO ADMIN and DEMO OPERATOR and is idempotent', async () => {
    const users = createInMemoryUserRepository();
    await seedUsers(users, testHasher, realConfig);

    const first = await seedDemoUsers(users, testHasher, configOf(demoEnv));
    await seedDemoUsers(users, testHasher, configOf(demoEnv));

    expect(first).toEqual([
      { email: 'demo.admin@alimentaiq.test', role: 'ADMIN' },
      { email: 'demo.operador@alimentaiq.test', role: 'OPERATOR' },
    ]);
    const all = [...users.users.values()];
    expect(all).toHaveLength(4);
    const demoAdmin = all.find((u) => u.email === 'demo.admin@alimentaiq.test');
    expect(demoAdmin).toMatchObject({ role: 'ADMIN', name: DEMO_NAMES.ADMIN, active: true });
    expect(await testHasher.compare('demo-admin-1', demoAdmin?.passwordHash ?? '')).toBe(true);
    // The real accounts keep their names, roles and passwords.
    const realAdmin = all.find((u) => u.email === 'admin@alimentaiq.test');
    expect(realAdmin?.name).toBe('Administrador AlimentaIQ');
    expect(await testHasher.compare('Strong-Admin-Pass-1', realAdmin?.passwordHash ?? '')).toBe(
      true,
    );
  });

  it('refuses to turn an existing non-demo account into a demo one', async () => {
    const users = createInMemoryUserRepository();
    await seedUsers(users, testHasher, realConfig);
    const clash = configOf({ ...demoEnv, SEED_DEMO_OPERATOR_EMAIL: 'operator@alimentaiq.test' });

    await expect(seedDemoUsers(users, testHasher, clash)).rejects.toThrow(SeedConfigError);
    const operator = [...users.users.values()].find((u) => u.email === 'operator@alimentaiq.test');
    expect(operator?.name).toBe('Operador AlimentaIQ');
    expect(users.users.size).toBe(2);
  });
});
