import type { Role } from '@prisma/client';
import { normalizeEmail } from '../modules/auth/auth.service.js';
import type { PasswordHasher } from '../modules/auth/password-hasher.js';
import type { UserRepository } from '../modules/users/user.repository.js';

export const SEED_VARIABLES = [
  'SEED_ADMIN_EMAIL',
  'SEED_ADMIN_PASSWORD',
  'SEED_OPERATOR_EMAIL',
  'SEED_OPERATOR_PASSWORD',
] as const;

export interface SeedAccount {
  email: string;
  password: string;
}

export interface SeedConfig {
  admin: SeedAccount;
  operator: SeedAccount;
}

/** Messages name variables and rules only, never values. */
export class SeedConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid seed configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'SeedConfigError';
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns the rules the admin password breaks (empty when it is strong enough). */
export function adminPasswordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push('at least 12 characters');
  if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
  if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
  if (!/[0-9]/.test(password)) problems.push('a number');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('a symbol');
  return problems;
}

/** Reads SEED_* without defaults: every variable is required. */
export function parseSeedConfig(source: NodeJS.ProcessEnv): SeedConfig {
  const problems: string[] = [];
  const read = (name: (typeof SEED_VARIABLES)[number]): string => {
    const value = source[name]?.trim() ?? '';
    if (!value) problems.push(`${name}: missing required variable`);
    return value;
  };

  const config: SeedConfig = {
    admin: { email: read('SEED_ADMIN_EMAIL'), password: read('SEED_ADMIN_PASSWORD') },
    operator: { email: read('SEED_OPERATOR_EMAIL'), password: read('SEED_OPERATOR_PASSWORD') },
  };

  for (const [name, email] of [
    ['SEED_ADMIN_EMAIL', config.admin.email],
    ['SEED_OPERATOR_EMAIL', config.operator.email],
  ] as const) {
    if (email && !EMAIL.test(email)) problems.push(`${name}: must be a valid email`);
  }
  if (
    config.admin.email &&
    normalizeEmail(config.admin.email) === normalizeEmail(config.operator.email)
  ) {
    problems.push('SEED_OPERATOR_EMAIL: must differ from SEED_ADMIN_EMAIL');
  }
  if (config.admin.password) {
    const weak = adminPasswordProblems(config.admin.password);
    if (weak.length > 0) problems.push(`SEED_ADMIN_PASSWORD: must contain ${weak.join(', ')}`);
  }

  if (problems.length > 0) {
    throw new SeedConfigError(problems);
  }
  return config;
}

export interface SeededUser {
  email: string;
  role: Role;
}

const SEED_USERS: { key: keyof SeedConfig; role: Role; name: string }[] = [
  { key: 'admin', role: 'ADMIN', name: 'Administrador AlimentaIQ' },
  { key: 'operator', role: 'OPERATOR', name: 'Operador AlimentaIQ' },
];

/** Idempotent: upserts by email, so running it twice never duplicates users. */
export async function seedUsers(
  users: UserRepository,
  hasher: PasswordHasher,
  config: SeedConfig,
): Promise<SeededUser[]> {
  const seeded: SeededUser[] = [];
  for (const { key, role, name } of SEED_USERS) {
    const account = config[key];
    const user = await users.upsertByEmail({
      email: normalizeEmail(account.email),
      name,
      passwordHash: await hasher.hash(account.password),
      role,
    });
    seeded.push({ email: user.email, role: user.role });
  }
  return seeded;
}
