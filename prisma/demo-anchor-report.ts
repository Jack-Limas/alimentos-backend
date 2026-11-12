// READ ONLY. Proposes the --anchor for the first manual seed:refresh-demo:
//   npm run demo:anchor-report -- --confirm-host=<host of DATABASE_URL>
// Reads the earliest createdAt of products, inventory_lots, orders and
// inventory_movements and the anchor in app_meta. Writes nothing. Prints the
// host and dates only, never the URL, user or password.
import dotenv from 'dotenv';
import { adviseAnchor } from '../src/modules/demo/anchor-report.js';
import { DEMO_ANCHOR_KEY } from '../src/modules/demo/index.js';
import { hostOf, parseConfirmHost } from '../src/seed/bench-guard.js';

const out = (line: string) => process.stdout.write(`${line}\n`);
const iso = (date: Date | null) => (date ? date.toISOString() : '—');

async function main(): Promise<number> {
  dotenv.config({ quiet: true });
  const host = hostOf(process.env.DATABASE_URL);
  if (!host) {
    out('demo:anchor-report: DATABASE_URL is missing or is not a valid URL.');
    return 1;
  }
  if (parseConfirmHost(process.argv.slice(2))?.toLowerCase() !== host.toLowerCase()) {
    out('demo:anchor-report refused: pass --confirm-host=<host of DATABASE_URL>.');
    out(`DATABASE_URL host: ${host}`);
    return 1;
  }
  out(`demo:anchor-report (read only) on host: ${host}`);

  const zone = process.env.APP_TIMEZONE?.trim() ?? '';
  const timeZone = zone === '' ? 'America/Bogota' : zone;
  const { prisma } = await import('../src/lib/prisma.js');
  try {
    // Only aggregates and one findUnique: nothing here can write.
    const [products, lots, orders, movements, anchor] = await Promise.all([
      prisma.product.aggregate({ _min: { createdAt: true } }),
      prisma.inventoryLot.aggregate({ _min: { createdAt: true } }),
      prisma.order.aggregate({ _min: { createdAt: true } }),
      prisma.inventoryMovement.aggregate({ _min: { createdAt: true } }),
      prisma.appMeta.findUnique({ where: { key: DEMO_ANCHOR_KEY } }),
    ]);
    const facts = {
      products: products._min.createdAt,
      lots: lots._min.createdAt,
      orders: orders._min.createdAt,
      movements: movements._min.createdAt,
      anchor: anchor?.value ?? null,
    };
    out(
      `  earliest products.createdAt:            ${iso(facts.products)} (the seed day: source of the proposal)`,
    );
    out(
      `  earliest inventory_lots.createdAt:      ${iso(facts.lots)} (backdated by the seed: reference only)`,
    );
    out(
      `  earliest orders.createdAt:              ${iso(facts.orders)} (backdated by the seed: reference only)`,
    );
    out(
      `  earliest inventory_movements.createdAt: ${iso(facts.movements)} (backdated by the seed: reference only)`,
    );
    out(`  app_meta.${DEMO_ANCHOR_KEY}:            ${facts.anchor ?? '— (none)'}`);

    const advice = adviseAnchor(facts, timeZone, new Date());
    switch (advice.kind) {
      case 'ALREADY_ANCHORED':
        out(
          `Anchor already stored (${advice.anchor}, ${String(advice.behindDays)} days behind today): ` +
            'no --anchor needed. seed:refresh-demo (or the daily refresh) moves from it.',
        );
        break;
      case 'EMPTY':
        out('No products or lots: run the seed first.');
        break;
      case 'PROPOSE':
        out(
          `Proposed first run: npm run seed:refresh-demo -- --confirm-host=${host} --anchor=${advice.anchor}` +
            ` (moves ${String(advice.daysToShift)} days).`,
        );
        break;
    }
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
      `demo:anchor-report failed: ${error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)}`,
    );
    process.exitCode = 1;
  });
