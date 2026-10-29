// Delivery history for the demo (impact page, reports): `npm run seed:history`.
// Idempotent: does nothing once any order is DELIVERED. Prints the database host
// and counts only, never the URL, users or passwords.
import dotenv from 'dotenv';
import { normalizeEmail } from '../src/modules/auth/auth.service.js';
import { todayIn } from '../src/modules/inventory/domain/index.js';
import { hostOf } from '../src/seed/bench-guard.js';
import { seedHistory } from '../src/seed/history-seed.js';
import { createPrismaHistorySeedStore } from '../src/seed/history-seed.prisma-store.js';

const out = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<number> {
  dotenv.config({ quiet: true });
  const host = hostOf(process.env.DATABASE_URL);
  if (!host) {
    out('seed:history: DATABASE_URL is missing or is not a valid URL.');
    return 1;
  }
  out(`seed:history target host: ${host}`);

  const { prisma } = await import('../src/lib/prisma.js');
  try {
    const find = (email: string | undefined) =>
      email?.trim()
        ? prisma.user.findUnique({ where: { email: normalizeEmail(email.trim()) } })
        : Promise.resolve(null);
    const admin = await find(process.env.SEED_ADMIN_EMAIL);
    if (!admin) {
      out('seed:history needs the regular seed first (npx prisma db seed) and SEED_ADMIN_EMAIL.');
      return 1;
    }
    const operator = (await find(process.env.SEED_OPERATOR_EMAIL)) ?? admin;

    const zone = process.env.APP_TIMEZONE?.trim() ?? '';
    const timeZone = zone === '' ? 'America/Bogota' : zone;
    const now = new Date();
    const result = await seedHistory(createPrismaHistorySeedStore(prisma), {
      today: todayIn(timeZone, now),
      now,
      timeZone,
      adminId: admin.id,
      operatorId: operator.id,
    });
    if (!result.seeded) {
      out(
        `seed:history: ${String(result.delivered)} DELIVERED orders already exist; nothing to do.`,
      );
      return 0;
    }
    const pct = result.orders === 0 ? 0 : Math.round((result.onTime / result.orders) * 1000) / 10;
    out(
      `seed:history: ${String(result.orders)} delivered orders (${String(result.onTime)} on time, ${String(pct)} %), ` +
        `${String(result.items)} items, ${String(result.history)} status rows, ` +
        `${String(result.linkedDispatches)} dispatches linked, ${String(result.waste)} waste movements`,
    );
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
    // The first line of a Prisma error may name the host, never the password.
    out(
      `seed:history failed: ${error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)}`,
    );
    process.exitCode = 1;
  });
