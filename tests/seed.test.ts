import { describe, expect, it } from 'vitest';
import {
  adminPasswordProblems,
  parseSeedConfig,
  SeedConfigError,
  seedUsers,
} from '../src/seed/seed-users.js';
import { createInMemoryUserRepository } from './helpers/in-memory-repositories.js';
import { testHasher } from './helpers/test-app.js';

const validEnv = {
  SEED_ADMIN_EMAIL: 'admin@alimentaiq.test',
  SEED_ADMIN_PASSWORD: 'Strong-Admin-Pass-1',
  SEED_OPERATOR_EMAIL: 'operator@alimentaiq.test',
  SEED_OPERATOR_PASSWORD: 'operator-pass',
};

describe('parseSeedConfig', () => {
  it('fails listing every missing variable when none are set', () => {
    expect(() => parseSeedConfig({})).toThrow(SeedConfigError);
    try {
      parseSeedConfig({});
    } catch (error) {
      expect((error as SeedConfigError).problems).toEqual([
        'SEED_ADMIN_EMAIL: missing required variable',
        'SEED_ADMIN_PASSWORD: missing required variable',
        'SEED_OPERATOR_EMAIL: missing required variable',
        'SEED_OPERATOR_PASSWORD: missing required variable',
      ]);
    }
  });

  it('rejects a weak admin password without echoing it', () => {
    const weak = 'qwzxk';

    expect(() => parseSeedConfig({ ...validEnv, SEED_ADMIN_PASSWORD: weak })).toThrow(
      /SEED_ADMIN_PASSWORD: must contain at least 12 characters, an uppercase letter, a number, a symbol/,
    );
    expect(() => parseSeedConfig({ ...validEnv, SEED_ADMIN_PASSWORD: weak })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(`${weak}\n`) as unknown }),
    );
  });

  it('rejects invalid or duplicated emails', () => {
    expect(() => parseSeedConfig({ ...validEnv, SEED_OPERATOR_EMAIL: 'nope' })).toThrow(
      /SEED_OPERATOR_EMAIL: must be a valid email/,
    );
    expect(() =>
      parseSeedConfig({ ...validEnv, SEED_OPERATOR_EMAIL: 'ADMIN@alimentaiq.test' }),
    ).toThrow(/must differ/);
  });

  it('accepts a complete configuration', () => {
    expect(parseSeedConfig(validEnv).admin.email).toBe('admin@alimentaiq.test');
  });
});

describe('adminPasswordProblems', () => {
  it('accepts 12+ characters with upper, lower, number and symbol', () => {
    expect(adminPasswordProblems('Strong-Admin-Pass-1')).toEqual([]);
  });

  it.each([
    ['Short-Pa1!', 'at least 12 characters'],
    ['lowercase-only-1!', 'an uppercase letter'],
    ['UPPERCASE-ONLY-1!', 'a lowercase letter'],
    ['No-Numbers-Here!', 'a number'],
    ['NoSymbolsHere123', 'a symbol'],
  ])('flags %s', (password, problem) => {
    expect(adminPasswordProblems(password)).toContain(problem);
  });
});

describe('seedUsers', () => {
  it('creates one ADMIN and one OPERATOR and is idempotent', async () => {
    const users = createInMemoryUserRepository();
    const config = parseSeedConfig(validEnv);

    await seedUsers(users, testHasher, config);
    const second = await seedUsers(users, testHasher, config);

    expect(users.users.size).toBe(2);
    expect(second).toEqual([
      { email: 'admin@alimentaiq.test', role: 'ADMIN' },
      { email: 'operator@alimentaiq.test', role: 'OPERATOR' },
    ]);
    const stored = [...users.users.values()];
    expect(stored.every((user) => user.passwordHash.startsWith('$2b$'))).toBe(true);
    expect(stored.some((user) => user.passwordHash.includes(validEnv.SEED_ADMIN_PASSWORD))).toBe(
      false,
    );
  });
});
