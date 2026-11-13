import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_CORRECTION_DAYS,
  parseAnchorArg,
  parseShiftDaysArg,
  planCorrection,
  planRefresh,
} from '../src/modules/demo/index.js';
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
    // The lock comes first, inside the transaction, before the work (anchor read, shift).
    const lock = source.indexOf('SELECT pg_advisory_xact_lock');
    expect(lock).toBeGreaterThan(source.indexOf('prisma.$transaction('));
    expect(source.indexOf('return work(tx)')).toBeGreaterThan(lock);
    // The daily refresh and the correction both run under it and share one shift.
    expect(source).toMatch(/refreshTo: [^\n]*\n\s*locked\(/);
    expect(source).toMatch(/correctBy: [^\n]*\n\s*locked\(/);
    expect(source.match(/UPDATE "inventory_lots"/g)).toHaveLength(1);
    expect(source.match(/shiftAll\(tx, /g)).toHaveLength(2);
    // The dry run returns before shiftAll and writeAnchor.
    const correction = source.slice(source.indexOf('correctBy:'));
    expect(correction.indexOf('if (dryRun)')).toBeLessThan(correction.indexOf('shiftAll(tx'));
    // Parameters, never string concatenation.
    expect(source).not.toMatch(/\$executeRawUnsafe/);
    // Users are never touched by the refresh (nor by the correction).
    expect(source).not.toMatch(/"users"|\.user\./);
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

describe('seed:refresh-demo --shift-days (correction)', () => {
  function service(anchor: string | null, now: { at: Date }) {
    const store = createInMemoryDemoRefreshStore();
    store.anchor = anchor;
    const auditLogs = createInMemoryAuditLogRepository();
    return {
      store,
      auditLogs,
      demo: createDemoRefreshService({
        store,
        audit: createAuditService(auditLogs),
        clock: () => now.at,
        timeZone: 'America/Bogota',
        log: { info: () => undefined, error: () => undefined },
      }),
    };
  }
  const noon12 = () => ({ at: new Date('2026-11-12T17:00:00Z') });

  it('reads --shift-days in both CLI forms, negative included', () => {
    expect(parseShiftDaysArg(['--confirm-host=h', '--shift-days=-61'])).toBe('-61');
    expect(parseShiftDaysArg(['--shift-days', '-61', '--dry-run'])).toBe('-61');
    expect(parseShiftDaysArg(['--anchor=2026-10-26'])).toBeUndefined();
  });

  it('accepts a whole number of days from -120 to 120, except 0', () => {
    expect(planCorrection('-61')).toEqual({ ok: true, days: -61 });
    expect(planCorrection('+3')).toEqual({ ok: true, days: 3 });
    expect(planCorrection(String(MAX_CORRECTION_DAYS))).toEqual({ ok: true, days: 120 });
    expect(planCorrection('-120')).toEqual({ ok: true, days: -120 });
    expect(planCorrection('0')).toEqual({ ok: false, reason: 'ZERO' });
    expect(planCorrection('-0')).toEqual({ ok: false, reason: 'ZERO' });
    expect(planCorrection('121')).toEqual({ ok: false, reason: 'TOO_FAR' });
    expect(planCorrection('-121')).toEqual({ ok: false, reason: 'TOO_FAR' });
    for (const bad of ['', '1.5', '-61d', 'abc', '1e2', '--61']) {
      expect(planCorrection(bad)).toEqual({ ok: false, reason: 'NOT_AN_INTEGER' });
    }
  });

  it('rejects the limits without touching the store or the audit log', async () => {
    const { demo, store, auditLogs } = service('2026-11-12', noon12());
    for (const days of ['0', '121', '-121', 'x']) {
      expect((await demo.correct(days, { dryRun: false })).ok).toBe(false);
    }
    expect(store.calls).toBe(0);
    expect(store.anchor).toBe('2026-11-12');
    expect(auditLogs.entries).toHaveLength(0);
  });

  it('moves everything 61 days back and leaves today as the anchor (the incident)', async () => {
    const { demo, store, auditLogs } = service('2026-11-12', noon12());
    const outcome = await demo.correct('-61', { dryRun: false });
    expect(outcome).toMatchObject({ ok: true, days: -61, dryRun: false });
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.before.stockExpiry).toEqual({ min: '2026-11-15', max: '2027-02-10' });
    expect(outcome.after.stockExpiry).toEqual({ min: '2026-09-15', max: '2026-12-11' });
    expect(outcome.after.activeDue).toEqual({ min: '2026-09-13', max: '2026-09-30' });
    expect(outcome.after.lastMovementAt?.toISOString()).toBe('2026-09-12T15:00:00.000Z');
    expect(store.shifts).toEqual([-61]);
    expect(store.anchor).toBe('2026-11-12');
    expect(auditLogs.entries).toHaveLength(1);
    expect(auditLogs.entries[0]).toMatchObject({ action: 'DEMO_REFRESHED' });
    expect(auditLogs.entries[0]?.metadata).toMatchObject({
      trigger: 'correction',
      days: -61,
      anchored: '2026-11-12',
    });
  });

  it('the dry run writes nothing: no shift, same anchor, same dates, no audit row', async () => {
    const { demo, store, auditLogs } = service('2026-11-12', noon12());
    const snapshot = store.snapshot;
    const outcome = await demo.correct('-61', { dryRun: true });
    expect(outcome).toMatchObject({
      ok: true,
      dryRun: true,
      counts: { lots: 3, orders: 2, history: 5, movements: 8 },
    });
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.after.stockExpiry.min).toBe('2026-09-15');
    expect(store.shifts).toEqual([]);
    expect(store.anchor).toBe('2026-11-12');
    expect(store.snapshot).toBe(snapshot);
    expect(auditLogs.entries).toHaveLength(0);
  });

  it('sets the anchor to the business day in Bogota, not the UTC one', async () => {
    const { demo, store } = service(null, { at: new Date('2026-11-13T04:30:00Z') });
    await demo.correct('-61', { dryRun: false });
    // 23:30 in Bogota: still the 12th there.
    expect(store.anchor).toBe('2026-11-12');
  });

  it('the daily refresh keeps working from the anchor the correction leaves', async () => {
    const now = noon12();
    const { demo, store } = service('2026-11-12', now);
    await demo.correct('-61', { dryRun: false });

    // Same day: a login moves nothing.
    demo.refreshIfDue('login');
    await demo.settled();
    expect(store.shifts).toEqual([-61]);
    expect(store.anchor).toBe('2026-11-12');

    // Next business day in Bogota: exactly one day forward, once.
    now.at = new Date('2026-11-13T15:00:00Z');
    demo.refreshIfDue('login');
    await demo.settled();
    demo.refreshIfDue('public-impact');
    await demo.settled();
    expect(store.shifts).toEqual([-61, 1]);
    expect(store.anchor).toBe('2026-11-13');
  });
});
