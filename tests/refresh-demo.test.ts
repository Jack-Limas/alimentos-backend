import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAnchorArg, planRefresh } from '../src/modules/demo/index.js';
import { createDemoRefreshService } from '../src/modules/demo/index.js';
import { createInMemoryAuditLogRepository } from './helpers/in-memory-repositories.js';
import { createInMemoryDemoRefreshStore } from './helpers/in-memory-demo-refresh.js';
import { createAuditService } from '../src/modules/audit/index.js';

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

describe('seed:refresh-demo through the DemoRefreshService (idempotent for a day)', () => {
  function service(anchor: string | null, today: string) {
    const store = createInMemoryDemoRefreshStore();
    store.anchor = anchor;
    const auditLogs = createInMemoryAuditLogRepository();
    return {
      store,
      auditLogs,
      demo: createDemoRefreshService({
        store,
        audit: createAuditService(auditLogs),
        clock: () => new Date(`${today}T17:00:00Z`),
        timeZone: 'America/Bogota',
        log: { info: () => undefined, error: () => undefined },
      }),
    };
  }

  it('the first run without --anchor only stores today', async () => {
    const { demo, store } = service(null, '2026-10-29');
    expect(await demo.run()).toEqual({ action: 'anchored', today: '2026-10-29' });
    expect(store.anchor).toBe('2026-10-29');
    expect(store.shifts).toEqual([]);
  });

  it('shifts once and then does nothing until the next day, auditing DEMO_REFRESHED', async () => {
    const { demo, store, auditLogs } = service('2026-10-26', '2026-10-29');
    expect(await demo.run()).toMatchObject({ action: 'shift', days: 3, counts: { lots: 3 } });
    expect(await demo.run()).toEqual({ action: 'none', today: '2026-10-29' });
    expect(store.shifts).toEqual([3]);
    expect(auditLogs.entries.filter((e) => e.action === 'DEMO_REFRESHED')).toHaveLength(1);
    expect(auditLogs.entries[0]?.metadata).toMatchObject({ trigger: 'script', days: 3 });
  });

  it('the SQL moves lots, orders, history and movements in one transaction', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/modules/demo/demo-refresh.prisma-store.ts'),
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
    // The lock comes first, inside the same transaction as the anchor read and the shift.
    const lock = source.indexOf('SELECT pg_advisory_xact_lock');
    expect(lock).toBeGreaterThan(source.indexOf('prisma.$transaction('));
    expect(lock).toBeLessThan(source.indexOf('tx.appMeta.findUnique'));
    expect(lock).toBeLessThan(source.indexOf('UPDATE "inventory_lots"'));
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
