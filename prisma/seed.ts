import dotenv from 'dotenv';
import { prisma } from '../src/lib/prisma.js';
import { createBcryptHasher } from '../src/modules/auth/password-hasher.js';
import { createPrismaUserRepository } from '../src/modules/users/user.prisma-repository.js';
import { parseSeedConfig, SeedConfigError, seedUsers } from '../src/seed/seed-users.js';

// Run with `npx prisma db seed`. Prints emails and roles only, never passwords.
async function main(): Promise<void> {
  dotenv.config({ quiet: true });
  const config = parseSeedConfig(process.env);
  const seeded = await seedUsers(createPrismaUserRepository(prisma), createBcryptHasher(), config);
  for (const user of seeded) {
    process.stdout.write(`Seeded ${user.role}: ${user.email}\n`);
  }
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof SeedConfigError ? error.message : `Seed failed: ${String(error)}`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
