/**
 * Calendar days in the family's time zone. A day is a 'YYYY-MM-DD' string, so days compare
 * and sort as text and never shift with the browser's own zone.
 */
export type Day = string;

const dayFormats = new Map<string, Intl.DateTimeFormat>();
const timeFormats = new Map<string, Intl.DateTimeFormat>();

/** The family's day that an instant falls on. */
export function dayIn(timeZone: string, instant: Date | string): Day {
  let format = dayFormats.get(timeZone);
  if (!format) {
    // en-CA writes dates as YYYY-MM-DD.
    format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormats.set(timeZone, format);
  }
  return format.format(new Date(instant));
}

/** An instant's clock time in the family's zone, such as "3:00 PM". */
export function timeIn(timeZone: string, instant: Date | string): string {
  let format = timeFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
    timeFormats.set(timeZone, format);
  }
  return format.format(new Date(instant));
}

/** Days are counted at noon UTC, so adding one never lands on the same or a skipped date. */
function noon(day: Day): Date {
  return new Date(`${day}T12:00:00Z`);
}

export function addDays(day: Day, days: number): Day {
  const date = noon(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 0 for Sunday through 6 for Saturday. */
export function weekdayOf(day: Day): number {
  return noon(day).getUTCDay();
}

/** The first day of the week holding <code>day</code>, for a week that starts on Sunday or Monday. */
export function startOfWeek(day: Day, weekStartsOn: 'Sunday' | 'Monday'): Day {
  const first = weekStartsOn === 'Sunday' ? 0 : 1;
  return addDays(day, -((weekdayOf(day) - first + 7) % 7));
}

export function startOfMonth(day: Day): Day {
  return `${day.slice(0, 8)}01`;
}

export function addMonths(day: Day, months: number): Day {
  const date = noon(startOfMonth(day));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

/** A day written for people, such as "Mon, Oct 12", using the given Intl options. */
export function formatDay(day: Day, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(noon(day));
}

/** The days from <code>from</code> up to, not including, <code>to</code>. */
export function daysBetween(from: Day, to: Day): Day[] {
  const days: Day[] = [];
  for (let day = from; day < to; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}
