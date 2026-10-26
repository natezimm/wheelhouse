import { Day, formatDay } from './days';

/** The weekdays as a repeat rule names them, Monday first. */
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const WEEKDAY_NAMES: Record<Weekday, string> = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday',
};
const ORDINALS: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', [-1]: 'last' };
const UNITS = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' } as const;

/** The parts of a repeat rule (RFC 5545) the screens understand. */
export interface RepeatRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  /** Weekdays, each with an optional position in the month: 'TU', or '2TU' for the second Tuesday, '-1FR' for the last Friday. */
  byDay: string[];
  byMonthDay: number[];
  byMonth: number[];
  count: number | null;
  /** The last day it may repeat on, in the family's days. */
  until: Day | null;
}

/** A rule such as "RRULE:FREQ=WEEKLY;BYDAY=TU,TH" read into its parts, or null when it is not one the screens understand. */
export function parseRule(text: string | null | undefined): RepeatRule | null {
  if (!text) return null;
  const parts = new Map(
    text.replace(/^RRULE:/i, '').split(';').filter(Boolean).map((part) => {
      const [key, value = ''] = part.split('=');
      return [key.toUpperCase(), value.toUpperCase()] as const;
    }),
  );
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  const numbers = (key: string) => (parts.get(key) ?? '').split(',').filter(Boolean).map(Number);
  const until = parts.get('UNTIL');
  const rule: RepeatRule = {
    freq,
    interval: Number(parts.get('INTERVAL') ?? 1),
    byDay: (parts.get('BYDAY') ?? '').split(',').filter(Boolean),
    byMonthDay: numbers('BYMONTHDAY'),
    byMonth: numbers('BYMONTH'),
    count: parts.has('COUNT') ? Number(parts.get('COUNT')) : null,
    until: until && /^\d{8}/.test(until) ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}` : null,
  };
  const valid = Number.isInteger(rule.interval) && rule.interval >= 1
    && rule.byDay.every((day) => /^(-?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$/.test(day))
    && rule.byMonthDay.every((day) => Number.isInteger(day) && day !== 0 && Math.abs(day) <= 31)
    && rule.byMonth.every((month) => Number.isInteger(month) && month >= 1 && month <= 12)
    && (rule.count === null || (Number.isInteger(rule.count) && rule.count >= 1));
  return valid ? rule : null;
}

/** A rule said for people: "Every week on Tuesday and Thursday", "Every month on the last Friday, until Mar 1, 2027". */
export function describeRule(text: string | null | undefined): string {
  const rule = parseRule(text);
  if (!rule) return 'Repeats';
  const unit = UNITS[rule.freq];
  let said = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;

  const weekdays = rule.byDay.filter((day) => /^[A-Z]{2}$/.test(day)) as Weekday[];
  const positioned = rule.byDay.filter((day) => !/^[A-Z]{2}$/.test(day));
  if (rule.freq === 'WEEKLY' && rule.interval === 1 && sameDays(weekdays, ['MO', 'TU', 'WE', 'TH', 'FR'])) {
    said = 'Every weekday';
  } else if (weekdays.length > 0 && positioned.length === 0) {
    said += ` on ${list(sortDays(weekdays).map((day) => WEEKDAY_NAMES[day]))}`;
  } else if (positioned.length > 0) {
    said += ` on the ${list(positioned.map((day) => {
      const [, n, weekday] = day.match(/^(-?\d)([A-Z]{2})$/)!;
      return `${ORDINALS[Number(n)] ?? `${n}th`} ${WEEKDAY_NAMES[weekday as Weekday]}`;
    }))}`;
  } else if (rule.byMonthDay.length > 0) {
    const days = rule.byMonthDay.map((day) => (day === -1 ? 'last day' : nth(day)));
    said += rule.freq === 'YEARLY' && rule.byMonth.length === 1
      ? ` on ${new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(Date.UTC(2001, rule.byMonth[0] - 1, 1))} ${rule.byMonthDay.join(', ')}`
      : ` on the ${list(days)}`;
  }

  if (rule.count !== null) said += rule.count === 1 ? ', once' : `, ${rule.count} times`;
  if (rule.until) said += `, until ${formatDay(rule.until, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return said;
}

/** Weekdays in the week's order, Monday first. */
export function sortDays(days: readonly Weekday[]): Weekday[] {
  return [...days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
}

function sameDays(a: readonly Weekday[], b: readonly Weekday[]): boolean {
  return a.length === b.length && b.every((day) => a.includes(day));
}

function nth(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

function list(items: string[]): string {
  return items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
