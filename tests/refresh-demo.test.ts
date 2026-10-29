import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseAnchorArg,
  planRefresh,
  refreshDemo,
  type RefreshDemoStore,
} from '../src/seed/refresh-demo.js';

describe('seed:refresh-demo plan', () => {
  it('moves the demo by the days since the stored anchor', () => {
    expect(planRefresh({ stored: '2026-10-20', fromArg: undefined, today: '2026-10-29' })).toEqual({
      action: 'shift',
      days: 9,
      from: '2026-10-20',
    });
  });

  it('does nothing twice on the same day', () => {
    expect(planRefresh({ stored: '2026-10-29', fromArg: undefined, today: '2026-10-29' })).toEqual({
      action: 'none',
      reason: 'SAME_DAY',
    });
  });

  it('uses --anchor only while nothing is stored', () => {
    expect(planRefresh({ stored: null, fromArg: '2026-10-25', today: '2026-10-29' })).toMatchObject(
      { action: 'shift', days: 4 },
    );
    expect(
      planRefresh({ stored: '2026-10-28', fromArg: '2026-10-01', today: '2026-10-29' }),
    ).toMatchObject({ action: 'shift', days: 1 });
  });

  it('refuses an anchor after today or that is not a date', () => {
    expect(planRefresh({ stored: '2026-11-02', fromArg: undefined, today: '2026-10-29' })).toEqual({
      action: 'refuse',
      reason: 'ANCHOR_IN_FUTURE',
    });
    expect(planRefresh({ stored: null, fromArg: 'yesterday', today: '2026-10-29' })).toEqual({
      action: 'refuse',
      reason: 'INVALID_ANCHOR',
    });
  });

  it('reads --anchor in both CLI forms', () => {
    expect(parseAnchorArg(['--confirm-host=h', '--anchor=2026-10-25'])).toBe('2026-10-25');
    expect(parseAnchorArg(['--anchor', '2026-10-25'])).toBe('2026-10-25');
    expect(parseAnchorArg(['--anchor='])).toBeUndefined();
    expect(parseAnchorArg([])).toBeUndefined();
  });
});

describe('refreshDemo (idempotent for a day)', () => {
  function memoryStore(anchor: string | null) {
    const shifts: number[] = [];
    const store: RefreshDemoStore & { anchor: string | null; shifts: number[] } = {
      anchor,
      shifts,
      readAnchor: () => Promise.resolve(store.anchor),
      writeAnchor: (today) => {
        store.anchor = today;
        return Promise.resolve();
      },
      shiftAndAnchor: (days, today) => {
        shifts.push(days);
        store.anchor = today;
        return Promise.resolve({ lots: 10, orders: 5, history: 20, movements: 40 });
      },
    };
    return store;
  }

  it('the first run without --anchor only stores today', async () => {
    const store = memoryStore(null);
    expect(await refreshDemo(store, { today: '2026-10-29' })).toEqual({
      action: 'anchored',
      today: '2026-10-29',
    });
    expect(store.anchor).toBe('2026-10-29');
    expect(store.shifts).toEqual([]);
  });

  it('shifts once and then does nothing until the next day', async () => {
    const store = memoryStore('2026-10-26');
    expect(await refreshDemo(store, { today: '2026-10-29' })).toMatchObject({
      action: 'shift',
      days: 3,
      counts: { lots: 10 },
    });
    expect(await refreshDemo(store, { today: '2026-10-29' })).toEqual({
      action: 'none',
      today: '2026-10-29',
    });
    expect(await refreshDemo(store, { today: '2026-10-30' })).toMatchObject({ days: 1 });
    expect(store.shifts).toEqual([3, 1]);
  });

  it('the SQL moves lots, orders, history and movements in one transaction', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/seed/refresh-demo.prisma-store.ts'),
      'utf8',
    );
    for (const table of [
      'inventory_lots',
      'orders',
      'order_status_history',
      'inventory_movements',
    ]) {
      expect(source).toContain(`UPDATE "${table}"`);
    }
    expect(source).toContain('$transaction');
    // Parameters, never string concatenation.
    expect(source).not.toMatch(/\$executeRawUnsafe/);
  });

  it('the app_meta migration is additive', () => {
    const sql = readFileSync(
      join(process.cwd(), 'prisma/migrations/20261029180000_add_app_meta/migration.sql'),
      'utf8',
    );
    expect(sql).toContain('CREATE TABLE "app_meta"');
    expect(sql).not.toMatch(/DROP|ALTER TABLE "(?!app_meta)/);
  });
});
