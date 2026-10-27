/** Calendar date "YYYY-MM-DD", with no time and no zone (contract, section 3). */
export type CalendarDate = string;

const DAY_MS = 86_400_000;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtcMs(date: CalendarDate): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

/** Rejects malformed strings and impossible dates such as 2026-02-30. */
export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) return false;
  const ms = toUtcMs(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/**
 * The business date of `instant` in `timeZone`. At 23:30 in Bogota (04:30 UTC
 * of the next day) this is still the Bogota date, not the UTC one.
 */
export function todayIn(timeZone: string, instant: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return new Date(toUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Prisma reads @db.Date columns as midnight UTC of that date. */
export function fromDbDate(date: Date): CalendarDate {
  return date.toISOString().slice(0, 10);
}

export function toDbDate(date: CalendarDate): Date {
  return new Date(toUtcMs(date));
}
