import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  fromDbDate,
  isCalendarDate,
  startOfDayIn,
  toDbDate,
  todayIn,
} from '../src/modules/inventory/domain/calendar.js';

const BOGOTA = 'America/Bogota'; // UTC-5 all year, no daylight saving time

describe('todayIn (America/Bogota)', () => {
  it('is still the previous day at 23:59 in Bogota, although UTC already changed', () => {
    // 2026-10-27T04:59Z = 2026-10-26 23:59 in Bogota
    expect(todayIn(BOGOTA, new Date('2026-10-27T04:59:59Z'))).toBe('2026-10-26');
  });

  it('switches at Bogota midnight (05:00 UTC)', () => {
    expect(todayIn(BOGOTA, new Date('2026-10-27T05:00:00Z'))).toBe('2026-10-27');
  });

  it('differs from the UTC date only in that five-hour band', () => {
    const instant = new Date('2026-10-27T02:00:00Z');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-10-27');
    expect(todayIn(BOGOTA, instant)).toBe('2026-10-26');
    expect(todayIn('UTC', instant)).toBe('2026-10-27');
  });

  it('crosses month and year boundaries', () => {
    expect(todayIn(BOGOTA, new Date('2027-01-01T04:30:00Z'))).toBe('2026-12-31');
  });
});

describe('daysBetween', () => {
  it('counts calendar days, negative when the target is in the past', () => {
    expect(daysBetween('2026-10-26', '2026-10-26')).toBe(0);
    expect(daysBetween('2026-10-26', '2026-11-02')).toBe(7);
    expect(daysBetween('2026-10-26', '2026-10-25')).toBe(-1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2); // leap year
  });

  it('gives a different day count one minute apart around Bogota midnight', () => {
    const expiry = '2026-10-30';
    const before = todayIn(BOGOTA, new Date('2026-10-27T04:59:00Z'));
    const after = todayIn(BOGOTA, new Date('2026-10-27T05:01:00Z'));

    expect(daysBetween(before, expiry)).toBe(4);
    expect(daysBetween(after, expiry)).toBe(3);
  });
});

describe('date helpers', () => {
  it('adds days across months', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('validates calendar dates', () => {
    expect(isCalendarDate('2026-10-26')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-10-26T00:00:00Z')).toBe(false);
    expect(isCalendarDate('26/10/2026')).toBe(false);
  });

  it('round-trips @db.Date values as UTC midnight', () => {
    expect(toDbDate('2026-10-26').toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(fromDbDate(new Date('2026-10-26T00:00:00.000Z'))).toBe('2026-10-26');
  });
});

describe('startOfDayIn', () => {
  it('gives the instant when a business day starts in the zone', () => {
    expect(startOfDayIn('2026-10-28', 'America/Bogota').toISOString()).toBe(
      '2026-10-28T05:00:00.000Z',
    );
    expect(startOfDayIn('2026-10-28', 'UTC').toISOString()).toBe('2026-10-28T00:00:00.000Z');
    expect(startOfDayIn('2026-01-01', 'Asia/Tokyo').toISOString()).toBe('2025-12-31T15:00:00.000Z');
  });

  it('follows daylight saving changes', () => {
    expect(startOfDayIn('2026-07-01', 'America/New_York').toISOString()).toBe(
      '2026-07-01T04:00:00.000Z',
    );
    expect(startOfDayIn('2026-12-01', 'America/New_York').toISOString()).toBe(
      '2026-12-01T05:00:00.000Z',
    );
  });
});
