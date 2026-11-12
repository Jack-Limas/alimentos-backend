// Only the two demo accounts (DEMO ADMIN, DEMO OPERATOR), nothing else:
//   npm run seed:demo-users
// Safe on the production database: it never touches the catalog, the real
// accounts or any business data. Prints the host, emails and roles only.
import dotenv from 'dotenv';
import { createBcryptHasher } from '../src/modules/auth/password-hasher.js';
import { createPrismaUserRepository } from '../src/modules/users/user.prisma-repository.js';
import { hostOf } from '../src/seed/bench-guard.js';
import { parseDemoUsersConfig, seedDemoUsers } from '../src/seed/demo-users.js';
import { SeedConfigError } from '../src/seed/seed-users.js';

const out = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<number> {
  dotenv.config({ quiet: true });
  const host = hostOf(process.env.DATABASE_URL);
  if (!host) {
    out('seed:demo-users: DATABASE_URL is missing or is not a valid URL.');
    return 1;
  }
  const demo = parseDemoUsersConfig(process.env);
  if (!demo.config) {
    out(`seed:demo-users: ${demo.skipped}`);
    return 1;
  }
  out(`seed:demo-users target host: ${host}`);
  const { prisma } = await import('../src/lib/prisma.js');
  try {
    const seeded = await seedDemoUsers(
      createPrismaUserRepository(prisma),
      createBcryptHasher(),
      demo.config,
    );
    for (const user of seeded) out(`Seeded demo ${user.role}: ${user.email}`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    out(
      error instanceof SeedConfigError
        ? error.message
        : `seed:demo-users failed: ${error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)}`,
    );
    process.exitCode = 1;
  });
