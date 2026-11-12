// Moves the demo forward to today before a presentation:
//   npm run seed:refresh-demo -- --confirm-host=<host of DATABASE_URL> [--anchor=YYYY-MM-DD]
// It edits dates in place, so it needs the database host named explicitly.
// --anchor is only for the first run: the business day the demo was seeded.
//
// Correction mode (undo or redo a wrong shift), same rows, same lock:
//   npm run seed:refresh-demo -- --confirm-host=<host> --shift-days=<N> [--dry-run]
// Moves everything by exactly N days (negative = back; 1 <= |N| <= 120) and
// leaves today as the anchor. --dry-run writes nothing: it prints what would
// move and the dates before/after.
// Prints the host, counts and dates only, never the URL, user or password.
import dotenv from 'dotenv';
import { createAuditService, createPrismaAuditLogRepository } from '../src/modules/audit/index.js';
import {
  createDemoRefreshService,
  createPrismaDemoRefreshStore,
  MAX_CORRECTION_DAYS,
  parseAnchorArg,
  parseShiftDaysArg,
  type CorrectionResult,
  type DemoRefreshService,
  type DemoSnapshot,
} from '../src/modules/demo/index.js';
import { todayIn } from '../src/modules/inventory/domain/index.js';
import { hostOf, parseConfirmHost } from '../src/seed/bench-guard.js';

const out = (line: string) => process.stdout.write(`${line}\n`);

const range = ({ min, max }: { min: string | null; max: string | null }) =>
  min === null ? '(none)' : `${min} .. ${max ?? ''}`;

/** The latest movement compared with now: after a correction it must not be in the future. */
function lastMovement(at: Date | null, now: Date): string {
  if (at === null) return '(none)';
  const hours = (at.getTime() - now.getTime()) / 3_600_000;
  const relation =
    hours > 0
      ? `IN THE FUTURE by ${(hours / 24).toFixed(1)} days`
      : `${(-hours / 24).toFixed(1)} days before now`;
  return `${at.toISOString()} (${relation})`;
}

function printSnapshot(label: string, snapshot: DemoSnapshot, now: Date): void {
  out(`  ${label}`);
  out(`    lots with stock, expiryDate:  ${range(snapshot.stockExpiry)}`);
  out(`    active orders, dueDate:       ${range(snapshot.activeDue)}`);
  out(`    latest movement createdAt:    ${lastMovement(snapshot.lastMovementAt, now)}`);
}

function printCorrection(result: CorrectionResult, today: string): void {
  const { lots, orders, history, movements } = result.counts;
  const direction = result.days < 0 ? 'back' : 'forward';
  out(
    `seed:refresh-demo ${result.dryRun ? 'DRY RUN (nothing written): would move' : 'moved'} ` +
      `${String(Math.abs(result.days))} days ${direction}: ` +
      `${String(lots)} lots, ${String(orders)} orders, ${String(history)} status rows, ${String(movements)} movements`,
  );
  out(`  anchor (app_meta.demo_anchor_date) ${result.dryRun ? 'would be' : 'is now'}: ${today}`);
  const now = new Date();
  printSnapshot('BEFORE', result.before, now);
  printSnapshot(result.dryRun ? 'AFTER (computed)' : 'AFTER', result.after, now);
}

async function correct(
  service: DemoRefreshService,
  rawDays: string,
  argv: readonly string[],
  today: string,
): Promise<number> {
  if (parseAnchorArg(argv) !== undefined) {
    out('seed:refresh-demo refused: --shift-days and --anchor cannot be combined.');
    return 1;
  }
  const outcome = await service.correct(rawDays, { dryRun: argv.includes('--dry-run') });
  if (!outcome.ok) {
    out(
      outcome.reason === 'NOT_AN_INTEGER'
        ? 'seed:refresh-demo refused: --shift-days must be a whole number of days (e.g. -61).'
        : outcome.reason === 'ZERO'
          ? 'seed:refresh-demo refused: --shift-days=0 moves nothing.'
          : `seed:refresh-demo refused: |--shift-days| must be at most ${String(MAX_CORRECTION_DAYS)}.`,
    );
    return 1;
  }
  printCorrection(outcome, today);
  return 0;
}

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
    const shiftDays = parseShiftDaysArg(argv);
    if (shiftDays !== undefined) return await correct(service, shiftDays, argv, today);
    if (argv.includes('--dry-run')) {
      out('seed:refresh-demo refused: --dry-run is only for --shift-days.');
      return 1;
    }
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
