import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adviseAnchor } from '../src/modules/demo/anchor-report.js';

const ZONE = 'America/Bogota';
const NOW = new Date('2026-11-12T17:00:00Z');

describe('demo:anchor-report', () => {
  it('proposes the business day the demo was seeded (earliest product)', () => {
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

  it('reproduces the main incident: backdated lots never move the anchor (2026-10-26, not 2026-08-26)', () => {
    const advice = adviseAnchor(
      {
        // The real seed of main: 23:23 in Bogota on 2026-10-26.
        products: new Date('2026-10-27T04:23:00Z'),
        // Lots are backdated by the seed (received weeks or months before).
        lots: new Date('2026-08-26T12:00:00Z'),
        orders: new Date('2026-09-25T12:00:00Z'),
        movements: new Date('2026-08-26T12:00:00Z'),
        anchor: null,
      },
      ZONE,
      new Date('2026-11-12T17:00:00Z'),
    );

    expect(advice).toEqual({ kind: 'PROPOSE', anchor: '2026-10-26', daysToShift: 17 });
  });

  it('needs products to propose anything: lots alone are not the seed day', () => {
    expect(
      adviseAnchor(
        { products: null, lots: NOW, orders: NOW, movements: NOW, anchor: null },
        ZONE,
        NOW,
      ),
    ).toEqual({ kind: 'EMPTY' });
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
