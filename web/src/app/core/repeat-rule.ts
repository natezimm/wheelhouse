import { Day, addDays, addMonths, dayIn, formatDay, weekdayOf } from './days';

/** The weekdays as a repeat rule names them, Monday first. */
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const WEEKDAY_NAMES: Record<Weekday, string> = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday',
};
const ORDINALS: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', [-1]: 'last' };
const KNOWN_PARTS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTH', 'BYMONTHDAY', 'COUNT', 'UNTIL', 'WKST']);
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

/**
 * A rule such as "RRULE:FREQ=WEEKLY;BYDAY=TU,TH" read into its parts, or null when it is not one the screens understand.
 * An end given as an instant is read as the family's day it falls on when their zone is given.
 */
export function parseRule(text: string | null | undefined, zone?: string): RepeatRule | null {
  if (!text) return null;
  const parts = new Map(
    text.replace(/^RRULE:/i, '').split(';').filter(Boolean).map((part) => {
      const [key, value = ''] = part.split('=');
      return [key.toUpperCase(), value.toUpperCase()] as const;
    }),
  );
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  // A part it does not know, such as BYSETPOS, changes what the rule means, so the rule is not understood.
  if ([...parts.keys()].some((key) => !KNOWN_PARTS.has(key)) || (parts.has('WKST') && parts.get('WKST') !== 'MO')) return null;
  const numbers = (key: string) => (parts.get(key) ?? '').split(',').filter(Boolean).map(Number);
  const until = parts.get('UNTIL');
  const rule: RepeatRule = {
    freq,
    interval: Number(parts.get('INTERVAL') ?? 1),
    byDay: (parts.get('BYDAY') ?? '').split(',').filter(Boolean),
    byMonthDay: numbers('BYMONTHDAY'),
    byMonth: numbers('BYMONTH'),
    count: parts.has('COUNT') ? Number(parts.get('COUNT')) : null,
    until: !until || !/^\d{8}/.test(until) ? null
      : zone && /^\d{8}T\d{6}Z$/.test(until)
        ? dayIn(zone, `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}T${until.slice(9, 11)}:${until.slice(11, 13)}:${until.slice(13, 15)}Z`)
        : `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`,
  };
  const valid = Number.isInteger(rule.interval) && rule.interval >= 1
    && rule.byDay.every((day) => /^(-?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$/.test(day))
    && rule.byMonthDay.every((day) => Number.isInteger(day) && day !== 0 && Math.abs(day) <= 31)
    && rule.byMonth.every((month) => Number.isInteger(month) && month >= 1 && month <= 12)
    && (rule.count === null || (Number.isInteger(rule.count) && rule.count >= 1));
  return valid ? rule : null;
}

/** A rule said for people: "Every week on Tuesday and Thursday", "Every month on the last Friday, until Mar 1, 2027". */
export function describeRule(text: string | null | undefined, zone?: string): string {
  const rule = parseRule(text, zone);
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

/**
 * A rule written for the API. Its end is a day; the API writes it as Google wants it. Weekdays
 * go in the week's order, so two rules that say the same thing are written the same.
 */
export function formatRule(rule: RepeatRule): string {
  const plain = rule.byDay.filter((day) => /^[A-Z]{2}$/.test(day)) as Weekday[];
  const positioned = rule.byDay.filter((day) => !/^[A-Z]{2}$/.test(day));
  const byDay = [...sortDays(plain), ...positioned];
  return [
    `RRULE:FREQ=${rule.freq}`,
    rule.interval > 1 ? `INTERVAL=${rule.interval}` : '',
    byDay.length ? `BYDAY=${byDay.join(',')}` : '',
    rule.byMonth.length ? `BYMONTH=${rule.byMonth.join(',')}` : '',
    rule.byMonthDay.length ? `BYMONTHDAY=${rule.byMonthDay.join(',')}` : '',
    rule.count !== null ? `COUNT=${rule.count}` : rule.until ? `UNTIL=${rule.until.replaceAll('-', '')}` : '',
  ].filter(Boolean).join(';');
}

/** The weekday a day falls on, as a rule names it. */
export function weekdayCode(day: Day): Weekday {
  return WEEKDAYS[(weekdayOf(day) + 6) % 7];
}

/** A day's place among its month's weekdays of its kind: 1 to 4, or -1 when it is the last. */
export function placeInMonth(day: Day): number {
  return addDays(day, 7).slice(5, 7) !== day.slice(5, 7) ? -1 : Math.ceil(Number(day.slice(8)) / 7);
}

/** One of the Repeat choices offered for an event starting on a given day. */
export interface RepeatPreset {
  id: 'never' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'monthlyByWeekday' | 'yearly';
  /** As the phone's list says it: "Every week on Tuesday". */
  label: string;
  /** As the wall's segments say it: "Weekly". */
  short: string;
  rule: string | null;
}

/** The ready-made repeats for an event starting on <code>day</code>, as calendars usually offer them. */
export function presetsFor(day: Day): RepeatPreset[] {
  const weekday = weekdayCode(day);
  const place = placeInMonth(day);
  const name = WEEKDAY_NAMES[weekday];
  return [
    { id: 'never', label: 'Does not repeat', short: 'Never', rule: null },
    { id: 'daily', label: 'Every day', short: 'Daily', rule: 'RRULE:FREQ=DAILY' },
    { id: 'weekdays', label: 'Every weekday (Monday to Friday)', short: 'Weekdays', rule: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    { id: 'weekly', label: `Every week on ${name}`, short: 'Weekly', rule: `RRULE:FREQ=WEEKLY;BYDAY=${weekday}` },
    { id: 'monthly', label: `Every month on the ${nth(Number(day.slice(8)))}`, short: 'Monthly', rule: `RRULE:FREQ=MONTHLY;BYMONTHDAY=${Number(day.slice(8))}` },
    { id: 'monthlyByWeekday', label: `Every month on the ${ORDINALS[place]} ${name}`, short: `${ORDINALS[place][0].toUpperCase()}${ORDINALS[place].slice(1)} ${name.slice(0, 3)}`,
      rule: `RRULE:FREQ=MONTHLY;BYDAY=${place}${weekday}` },
    { id: 'yearly', label: `Every year on ${formatDay(day, { month: 'long', day: 'numeric' })}`, short: 'Yearly',
      rule: `RRULE:FREQ=YEARLY;BYMONTH=${Number(day.slice(5, 7))};BYMONTHDAY=${Number(day.slice(8))}` },
  ];
}

/**
 * A rule written the one way the screens write it, for comparing and for sending: a weekly rule
 * names its weekdays, a monthly one its date and a yearly one its month and date, as
 * <code>day</code> gives them, so a change to a whole series repeats on the days it says even
 * though the series counts from its first event. Null when it does not repeat or is a rule the
 * screens do not understand.
 */
export function canonicalRule(text: string | null | undefined, day: Day, zone?: string): string | null {
  const rule = parseRule(text, zone);
  if (!rule) return null;
  if (rule.freq === 'WEEKLY' && rule.byDay.length === 0) rule.byDay = [weekdayCode(day)];
  if (rule.freq === 'MONTHLY' && rule.byDay.length === 0 && rule.byMonthDay.length === 0) rule.byMonthDay = [Number(day.slice(8))];
  if (rule.freq === 'YEARLY' && rule.byMonth.length === 0 && rule.byMonthDay.length === 0) {
    rule.byMonth = [Number(day.slice(5, 7))];
    rule.byMonthDay = [Number(day.slice(8))];
  }
  return formatRule(rule);
}

/** Which ready-made repeat a rule is for an event on <code>day</code>; null for one only Custom sets. */
export function presetOf(text: string | null | undefined, day: Day, zone?: string): RepeatPreset | null {
  if (!text) return presetsFor(day)[0];
  const canonical = canonicalRule(text, day, zone);
  return presetsFor(day).find((preset) => preset.rule && canonicalRule(preset.rule, day) === canonical) ?? null;
}

/**
 * The rule an event moved from one first day to another keeps: a ready-made repeat follows the
 * day, so Weekly on Tuesday becomes Weekly on Wednesday; a custom rule stays as it was set.
 */
export function followDay(text: string | null, from: Day, to: Day): string | null {
  const preset = text && from !== to ? presetOf(text, from) : null;
  return preset ? presetsFor(to).find((p) => p.id === preset.id)!.rule : text;
}

/**
 * The days a series starting on <code>first</code> falls on from <code>from</code> up to
 * <code>to</code> (exclusive), as Google and the API expand the rule: the first event always
 * counts, a monthly date skips months too short for it, and February 29 waits for leap years.
 */
export function ruleDays(first: Day, rule: RepeatRule, from: Day, to: Day): Day[] {
  const days: Day[] = [];
  let count = 0;
  const take = (day: Day): boolean => {
    if (rule.until && day > rule.until && day !== first) return false;
    if (day >= to) return false;
    count++;
    if (day >= from) days.push(day);
    return rule.count === null || count < rule.count;
  };
  if (!take(first)) return days;
  const interval = Math.max(1, rule.interval);
  for (let k = 0; k < 20_000; k++) {
    for (const day of candidates(first, rule, k * interval)) {
      if (day <= first) continue;
      if (!take(day)) return days;
    }
  }
  return days;
}

function candidates(first: Day, rule: RepeatRule, step: number): Day[] {
  switch (rule.freq) {
    case 'DAILY':
      return [addDays(first, step)];
    case 'WEEKLY': {
      const monday = addDays(first, -((weekdayOf(first) + 6) % 7));
      const plain = rule.byDay.filter((day) => /^[A-Z]{2}$/.test(day)) as Weekday[];
      return sortDays(plain.length ? plain : [weekdayCode(first)]).map((day) => addDays(monday, 7 * step + WEEKDAYS.indexOf(day)));
    }
    case 'MONTHLY': {
      const month = addMonths(first, step);
      const length = Number(addDays(addMonths(first, step + 1), -1).slice(8));
      const positioned = rule.byDay.find((day) => !/^[A-Z]{2}$/.test(day));
      if (positioned) {
        const [, n, weekday] = positioned.match(/^(-?\d)([A-Z]{2})$/)!;
        const firstOfKind = addDays(month, (WEEKDAYS.indexOf(weekday as Weekday) - (weekdayOf(month) + 6) % 7 + 7) % 7);
        const place = Number(n);
        const day = place === -1 ? addDays(firstOfKind, 7 * Math.floor((length - Number(firstOfKind.slice(8))) / 7)) : addDays(firstOfKind, 7 * (place - 1));
        return day.slice(0, 7) === month.slice(0, 7) ? [day] : [];
      }
      const date = rule.byMonthDay[0] ?? Number(first.slice(8));
      if (date === -1) return [`${month.slice(0, 8)}${String(length).padStart(2, '0')}`];
      return date <= length ? [`${month.slice(0, 8)}${String(date).padStart(2, '0')}`] : [];
    }
    default: {
      const month = String(rule.byMonth[0] ?? Number(first.slice(5, 7))).padStart(2, '0');
      const date = String(rule.byMonthDay[0] ?? Number(first.slice(8))).padStart(2, '0');
      const day = `${Number(first.slice(0, 4)) + step}-${month}-${date}`;
      return addDays(day, 0) === day ? [day] : [];
    }
  }
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
