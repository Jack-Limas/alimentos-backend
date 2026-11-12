// Moves the demo forward to today before a presentation:
//   npm run seed:refresh-demo -- --confirm-host=<host of DATABASE_URL> [--anchor=YYYY-MM-DD]
// It edits dates in place, so it needs the database host named explicitly.
// --anchor is only for the first run: the business day the demo was seeded.
// Prints the host and counts only, never the URL, user or password.
import dotenv from 'dotenv';
import { createAuditService, createPrismaAuditLogRepository } from '../src/modules/audit/index.js';
import {
  createDemoRefreshService,
  createPrismaDemoRefreshStore,
  parseAnchorArg,
} from '../src/modules/demo/index.js';
import { todayIn } from '../src/modules/inventory/domain/index.js';
import { hostOf, parseConfirmHost } from '../src/seed/bench-guard.js';

const out = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<number> {
  dotenv.config({ quiet: true });
  const argv = process.argv.slice(2);
  const host = hostOf(process.env.DATABASE_URL);
  if (!host) {
    out('seed:refresh-demo: DATABASE_URL is missing or is not a valid URL.');
    return 1;
  }
  const confirmHost = parseConfirmHost(argv);
  if (confirmHost?.toLowerCase() !== host.toLowerCase()) {
    out('seed:refresh-demo refused: pass --confirm-host=<host of DATABASE_URL>.');
    out(`DATABASE_URL host: ${host}`);
    return 1;
  }
  out(`seed:refresh-demo target host: ${host}`);

  const zone = process.env.APP_TIMEZONE?.trim() ?? '';
  const timeZone = zone === '' ? 'America/Bogota' : zone;
  const today = todayIn(timeZone, new Date());
  const { prisma } = await import('../src/lib/prisma.js');
  try {
    // The same service the API uses for the lazy daily refresh (same lock, same audit row).
    const service = createDemoRefreshService({
      store: createPrismaDemoRefreshStore(prisma),
      audit: createAuditService(createPrismaAuditLogRepository(prisma)),
      clock: () => new Date(),
      timeZone,
      log: { info: () => undefined, error: () => undefined },
    });
    const result = await service.run({ fromArg: parseAnchorArg(argv) });
    switch (result.action) {
      case 'refuse':
        out(
          result.reason === 'INVALID_ANCHOR'
            ? 'seed:refresh-demo refused: --anchor must be a date YYYY-MM-DD.'
            : 'seed:refresh-demo refused: the anchor is after today.',
        );
        return 1;
      case 'anchored':
        out(`seed:refresh-demo: anchor set to ${result.today}; nothing to move today.`);
        return 0;
      case 'none':
        out(`seed:refresh-demo: already fresh for ${result.today}; nothing to do.`);
        return 0;
      case 'shift': {
        const { lots, orders, history, movements } = result.counts;
        out(
          `seed:refresh-demo: moved ${String(result.days)} days forward (from ${result.from} to ${today}): ` +
            `${String(lots)} lots, ${String(orders)} orders, ${String(history)} status rows, ${String(movements)} movements`,
        );
        return 0;
      }
    }
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
      `seed:refresh-demo failed: ${error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)}`,
    );
    process.exitCode = 1;
  });
