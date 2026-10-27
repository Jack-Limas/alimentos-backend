import dotenv from 'dotenv';
import { isValidTimeZone } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { normalizeEmail } from '../src/modules/auth/auth.service.js';
import { todayIn } from '../src/modules/inventory/domain/index.js';
import { createBcryptHasher } from '../src/modules/auth/password-hasher.js';
import { createPrismaUserRepository } from '../src/modules/users/user.prisma-repository.js';
import { createPrismaCatalogSeedStore } from '../src/seed/catalog-seed.prisma-store.js';
import { seedCatalog } from '../src/seed/seed-catalog.js';
import { createPrismaOrdersSeedStore } from '../src/seed/orders-seed.prisma-store.js';
import { seedOrders } from '../src/seed/seed-orders.js';
import { parseSeedConfig, SeedConfigError, seedUsers } from '../src/seed/seed-users.js';

const DEFAULT_TIME_ZONE = 'America/Bogota';

function businessTimeZone(): string {
  // An empty APP_TIMEZONE= (copied from .env.example) means "use the default".
  const raw = process.env.APP_TIMEZONE?.trim() ?? '';
  const value = raw === '' ? DEFAULT_TIME_ZONE : raw;
  if (!isValidTimeZone(value)) {
    throw new SeedConfigError(['APP_TIMEZONE: must be an IANA time zone such as America/Bogota']);
  }
  return value;
}

// Run with `npx prisma db seed`. Prints emails, roles and counts only, never passwords.
async function main(): Promise<void> {
  dotenv.config({ quiet: true });
  const config = parseSeedConfig(process.env);
  const timeZone = businessTimeZone();

  const users = createPrismaUserRepository(prisma);
  const seeded = await seedUsers(users, createBcryptHasher(), config);
  for (const user of seeded) {
    process.stdout.write(`Seeded ${user.role}: ${user.email}\n`);
  }

  const admin = await users.findByEmail(normalizeEmail(config.admin.email));
  if (!admin) throw new Error('The seeded admin user was not found');

  const now = new Date();
  const today = todayIn(timeZone, now);
  const result = await seedCatalog({
    store: createPrismaCatalogSeedStore(prisma),
    adminUserId: admin.id,
    today,
  });
  process.stdout.write(
    result.inventorySeeded
      ? `Seeded catalog: ${result.productsCreated} products, ${result.lotsCreated} lots, ` +
          `${result.movementsCreated} movements (relative to ${today} in ${timeZone})\n`
      : `Catalog already present: ${result.productsCreated} missing products added, inventory untouched\n`,
  );

  const orders = await seedOrders({
    store: createPrismaOrdersSeedStore(prisma),
    adminUserId: admin.id,
    today,
    now,
  });
  process.stdout.write(
    orders.ordersCreated > 0
      ? `Seeded customers: ${orders.customersCreated}; orders: ${orders.ordersCreated} ` +
          `with ${orders.itemsCreated} items (relative to ${today})\n`
      : `Orders already present: ${orders.customersCreated} customers added, orders untouched\n`,
  );
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof SeedConfigError ? error.message : `Seed failed: ${String(error)}`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
