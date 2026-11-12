import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adviseAnchor } from '../src/modules/demo/anchor-report.js';

const ZONE = 'America/Bogota';
const NOW = new Date('2026-11-12T17:00:00Z');

describe('demo:anchor-report', () => {
  it('proposes the business day the demo was seeded (earliest product or lot)', () => {
    const advice = adviseAnchor(
      {
        // 20:30 in Bogota on 2026-10-28 = 01:30 UTC on 2026-10-29: the business day is the 28th.
        products: new Date('2026-10-29T01:30:00Z'),
        lots: new Date('2026-10-29T01:31:00Z'),
        // Backdated by the seed on purpose: never the anchor.
        orders: new Date('2026-10-10T12:00:00Z'),
        movements: new Date('2026-09-30T12:00:00Z'),
        anchor: null,
      },
      ZONE,
      NOW,
    );

    expect(advice).toEqual({ kind: 'PROPOSE', anchor: '2026-10-28', daysToShift: 15 });
  });

  it('proposes nothing when an anchor is already stored, and says how far behind it is', () => {
    expect(
      adviseAnchor(
        { products: NOW, lots: NOW, orders: null, movements: null, anchor: '2026-11-09' },
        ZONE,
        NOW,
      ),
    ).toEqual({ kind: 'ALREADY_ANCHORED', anchor: '2026-11-09', behindDays: 3 });
  });

  it('says the database is empty when there is nothing seeded', () => {
    expect(
      adviseAnchor(
        { products: null, lots: null, orders: null, movements: null, anchor: null },
        ZONE,
        NOW,
      ),
    ).toEqual({ kind: 'EMPTY' });
  });

  it('the script only reads: aggregates and findUnique, no writes', () => {
    const source = readFileSync(join(process.cwd(), 'prisma/demo-anchor-report.ts'), 'utf8');
    expect(source).toMatch(/aggregate\(/);
    expect(source).not.toMatch(
      /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$transaction/,
    );
    expect(source).toContain('--confirm-host');
  });
});
