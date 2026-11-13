import type { Role } from '@prisma/client';
import { normalizeEmail } from '../modules/auth/auth.service.js';
import type { PasswordHasher } from '../modules/auth/password-hasher.js';
import type { UserRepository } from '../modules/users/user.repository.js';
import { SeedConfigError, type SeedAccount, type SeededUser } from './seed-users.js';

/**
 * Demo accounts for evaluating the app in production (there is no public
 * sign-up: AlimentaIQ is an internal system). Their passwords are PUBLIC on
 * purpose (they go to the evaluator), so the admin password policy does not
 * apply; only a minimum length does. They never replace the real accounts.
 */
export const DEMO_SEED_VARIABLES = [
  'SEED_DEMO_ADMIN_EMAIL',
  'SEED_DEMO_ADMIN_PASSWORD',
  'SEED_DEMO_OPERATOR_EMAIL',
  'SEED_DEMO_OPERATOR_PASSWORD',
] as const;

export const DEMO_PASSWORD_MIN_LENGTH = 10;

/** Display names of the demo accounts ("Operador Demo" → avatar "OD"). */
export const DEMO_NAMES: Readonly<Record<Role, string>> = {
  ADMIN: 'Administrador Demo',
  OPERATOR: 'Operador Demo',
};

/** Names the demo accounts had before (renamed on the next seed run). */
const LEGACY_DEMO_NAMES: readonly string[] = ['Demo · Administrador', 'Demo · Operador'];

/**
 * Whether an existing user can be managed as the demo account of `role`.
 * Demo accounts are identified by their email (SEED_DEMO_*_EMAIL: the only
 * users this seed ever looks up). The protection stays: a user that already
 * has that email is only updated when it was created as a demo account (a
 * demo name, current or legacy) and keeps its role. Anyone else's account is
 * never turned into a demo one or given a public password; neither is a user
 * an ADMIN created in the app (isProtected false), even with a demo name.
 */
export function canManageAsDemo(
  existing: { name: string; role: Role; isProtected: boolean },
  role: Role,
): boolean {
  const demoName = existing.name === DEMO_NAMES[role] || LEGACY_DEMO_NAMES.includes(existing.name);
  return existing.isProtected && demoName && existing.role === role;
}

export interface DemoUsersConfig {
  admin: SeedAccount;
  operator: SeedAccount;
}

export type DemoUsersParse =
  | { config: DemoUsersConfig; skipped?: undefined }
  /** Some or all variables are missing: the demo accounts are skipped, nothing fails. */
  | { config: null; skipped: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reads SEED_DEMO_* without defaults. Missing variables skip the demo accounts
 * with a notice (current environments keep working); present but invalid
 * values are an error. Messages name variables and rules, never values.
 */
export function parseDemoUsersConfig(source: NodeJS.ProcessEnv): DemoUsersParse {
  const value = (name: (typeof DEMO_SEED_VARIABLES)[number]) => source[name]?.trim() ?? '';
  const missing = DEMO_SEED_VARIABLES.filter((name) => value(name) === '');
  if (missing.length > 0) {
    return { config: null, skipped: `demo accounts skipped: missing ${missing.join(', ')}` };
  }

  const config: DemoUsersConfig = {
    admin: { email: value('SEED_DEMO_ADMIN_EMAIL'), password: value('SEED_DEMO_ADMIN_PASSWORD') },
    operator: {
      email: value('SEED_DEMO_OPERATOR_EMAIL'),
      password: value('SEED_DEMO_OPERATOR_PASSWORD'),
    },
  };
  const problems: string[] = [];
  for (const [prefix, account] of [
    ['SEED_DEMO_ADMIN', config.admin],
    ['SEED_DEMO_OPERATOR', config.operator],
  ] as const) {
    if (!EMAIL.test(account.email)) problems.push(`${prefix}_EMAIL: must be a valid email`);
    if (account.password.length < DEMO_PASSWORD_MIN_LENGTH) {
      problems.push(
        `${prefix}_PASSWORD: must be at least ${String(DEMO_PASSWORD_MIN_LENGTH)} characters`,
      );
    }
  }
  const demoEmails = [config.admin.email, config.operator.email].map(normalizeEmail);
  if (demoEmails[0] === demoEmails[1]) {
    problems.push('SEED_DEMO_OPERATOR_EMAIL: must differ from SEED_DEMO_ADMIN_EMAIL');
  }
  // Never the email of a real account.
  for (const real of ['SEED_ADMIN_EMAIL', 'SEED_OPERATOR_EMAIL'] as const) {
    const email = source[real]?.trim();
    if (email && demoEmails.includes(normalizeEmail(email))) {
      problems.push(`SEED_DEMO_*_EMAIL: must differ from ${real}`);
    }
  }
  if (problems.length > 0) throw new SeedConfigError(problems);
  return { config };
}

/**
 * Idempotent: upserts the two demo accounts by email (SEED_DEMO_*_EMAIL).
 * Refuses to update an existing user with that email that is not a demo
 * account (see canManageAsDemo), before touching anything.
 */
export async function seedDemoUsers(
  users: UserRepository,
  hasher: PasswordHasher,
  config: DemoUsersConfig,
): Promise<SeededUser[]> {
  const accounts = [
    { account: config.admin, role: 'ADMIN' as const },
    { account: config.operator, role: 'OPERATOR' as const },
  ];
  for (const { account, role } of accounts) {
    const existing = await users.findByEmail(normalizeEmail(account.email));
    if (existing && !canManageAsDemo(existing, role)) {
      throw new SeedConfigError([
        'SEED_DEMO_*_EMAIL: belongs to an existing account that is not a demo account',
      ]);
    }
  }
  const seeded: SeededUser[] = [];
  for (const { account, role } of accounts) {
    const user = await users.upsertByEmail({
      email: normalizeEmail(account.email),
      name: DEMO_NAMES[role],
      passwordHash: await hasher.hash(account.password),
      role,
    });
    seeded.push({ email: user.email, role: user.role });
  }
  return seeded;
}
