// Large dataset for the `bench` Neon branch only:
//   npm run seed:bench -- --confirm-host=<host of DATABASE_URL>
// Refuses in production or when the host does not match. Prints the host
// (never the URL, user or password) and the time of each table.
import dotenv from 'dotenv';
import { normalizeEmail } from '../src/modules/auth/auth.service.js';
import { todayIn } from '../src/modules/inventory/domain/index.js';
import { BENCH_PREFIX, buildBenchData, inBatches } from '../src/seed/bench-data.js';
import { checkBenchTarget, parseConfirmHost, REFUSAL_MESSAGES } from '../src/seed/bench-guard.js';

const BATCH = 1_000;
const out = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<number> {
  dotenv.config({ quiet: true });
  const target = checkBenchTarget({
    databaseUrl: process.env.DATABASE_URL,
    confirmHost: parseConfirmHost(process.argv.slice(2)),
    nodeEnv: process.env.NODE_ENV,
  });
  if (!target.ok) {
    out(`seed:bench refused: ${REFUSAL_MESSAGES[target.reason]}`);
    if (target.host) out(`DATABASE_URL host: ${target.host}`);
    return 1;
  }
  out(`seed:bench target host: ${target.host}`);

  // Imported after the checks: Prisma connects only once the target is confirmed.
  const { prisma } = await import('../src/lib/prisma.js');
  try {
    const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim();
    const admin = adminEmail
      ? await prisma.user.findUnique({ where: { email: normalizeEmail(adminEmail) } })
      : null;
    if (!admin) {
      out('seed:bench needs the regular seed first (npx prisma db seed) and SEED_ADMIN_EMAIL.');
      return 1;
    }
    const existing = await prisma.product.count({
      where: { name: { startsWith: `${BENCH_PREFIX} ` } },
    });
    if (existing > 0) {
      out(`seed:bench: ${String(existing)} bench products already exist; nothing to do.`);
      return 0;
    }

    const now = new Date();
    // An empty APP_TIMEZONE= (copied from .env.example) means the default zone.
    const zone = process.env.APP_TIMEZONE?.trim() ?? '';
    const timeZone = zone === '' ? 'America/Bogota' : zone;
    const data = buildBenchData({ today: todayIn(timeZone, now), now, userId: admin.id });
    const started = performance.now();

    const steps: [string, () => Promise<number>][] = [
      [
        'products',
        () => insert(data.products, (rows) => prisma.product.createMany({ data: rows })),
      ],
      [
        'customers',
        () => insert(data.customers, (rows) => prisma.customer.createMany({ data: rows })),
      ],
      ['lots', () => insert(data.lots, (rows) => prisma.inventoryLot.createMany({ data: rows }))],
      [
        'movements',
        () => insert(data.movements, (rows) => prisma.inventoryMovement.createMany({ data: rows })),
      ],
      ['orders', () => insert(data.orders, (rows) => prisma.order.createMany({ data: rows }))],
      [
        'order items',
        () => insert(data.items, (rows) => prisma.orderItem.createMany({ data: rows })),
      ],
      [
        'order history',
        () => insert(data.history, (rows) => prisma.orderStatusHistory.createMany({ data: rows })),
      ],
    ];
    for (const [name, step] of steps) {
      const t = performance.now();
      const count = await step();
      out(
        `  ${name.padEnd(14)} ${String(count).padStart(6)} rows in ${String(Math.round(performance.now() - t))} ms`,
      );
    }
    out(`seed:bench done in ${String(Math.round(performance.now() - started))} ms`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

/** createMany in batches of BATCH rows; returns how many were inserted. */
async function insert<T>(
  rows: readonly T[],
  create: (batch: T[]) => Promise<{ count: number }>,
): Promise<number> {
  let total = 0;
  for (const batch of inBatches(rows, BATCH)) total += (await create(batch)).count;
  return total;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // The message of a Prisma error may include the host, never the password.
    out(
      `seed:bench failed: ${error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)}`,
    );
    process.exitCode = 1;
  });
