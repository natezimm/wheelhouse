import { Day, addDays, addMonths, formatDay, startOfMonth, startOfWeek } from './days';

/** The calendar's three views, on every layout. */
export type CalendarView = 'day' | 'week' | 'month';

export const VIEWS: readonly { view: CalendarView; label: string }[] = [
  { view: 'day', label: 'Day' },
  { view: 'week', label: 'Week' },
  { view: 'month', label: 'Month' },
];

/** The days a view shows around a day, and how the toolbar names them. */
export interface Period {
  /** The first day shown, and the day after the last. */
  start: Day;
  end: Day;
  /** Such as "October 19 – 25", "Thursday, October 22" or "October". */
  title: string;
  /** The year, set apart from the title; empty when the title already has it. */
  year: string;
  /** What the arrows move by: day, week or month. */
  unit: string;
  /** Whether today is in it, so Today has nothing to do. */
  isCurrent: boolean;
}

export function periodOf(view: CalendarView, day: Day, today: Day, weekStartsOn: 'Sunday' | 'Monday'): Period {
  if (view === 'day') {
    return {
      start: day,
      end: addDays(day, 1),
      title: formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' }),
      year: day.slice(0, 4),
      unit: 'day',
      isCurrent: day === today,
    };
  }
  if (view === 'week') {
    const start = startOfWeek(day, weekStartsOn);
    const last = addDays(start, 6);
    return { start, end: addDays(start, 7), ...weekTitle(start, last), unit: 'week', isCurrent: start <= today && today <= last };
  }
  const first = startOfMonth(day);
  return {
    start: first,
    end: addMonths(first, 1),
    title: formatDay(first, { month: 'long' }),
    year: first.slice(0, 4),
    unit: 'month',
    isCurrent: first === startOfMonth(today),
  };
}

/** The day the arrows move to: the same weekday a week away, or the same date a month away (or that month's last day). */
export function stepFrom(view: CalendarView, day: Day, by: number): Day {
  if (view === 'day') {
    return addDays(day, by);
  }
  if (view === 'week') {
    return addDays(day, by * 7);
  }
  const target = addMonths(day, by);
  const lastDay = addDays(addMonths(target, 1), -1);
  const wanted = `${target.slice(0, 8)}${day.slice(8)}`;
  return wanted > lastDay ? lastDay : wanted;
}

/** "October 19 – 25", "October 26 – November 1", or with both years across a year's end. */
function weekTitle(first: Day, last: Day): { title: string; year: string } {
  const from = formatDay(first, { month: 'long', day: 'numeric' });
  if (first.slice(0, 4) !== last.slice(0, 4)) {
    return { title: `${from}, ${first.slice(0, 4)} – ${formatDay(last, { month: 'long', day: 'numeric' })}`, year: last.slice(0, 4) };
  }
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  const to = formatDay(last, sameMonth ? { day: 'numeric' } : { month: 'long', day: 'numeric' });
  return { title: `${from} – ${to}`, year: first.slice(0, 4) };
}
