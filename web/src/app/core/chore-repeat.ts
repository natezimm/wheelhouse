import { Day, addDays, weekdayOf } from './days';

export interface ChoreRepeat {
  frequency: 'Daily' | 'Weekly'; intervalWeeks: number; weekdays: number[]; endsOn: Day | null;
}

export function repeatOn(repeat: ChoreRepeat, start: Day, day: Day): boolean {
  if (day < start || repeat.endsOn && day > repeat.endsOn) return false;
  if (repeat.frequency === 'Daily') return true;
  const monday = addDays(start, -((weekdayOf(start) + 6) % 7));
  const weeks = Math.floor((Date.parse(day + 'T12:00:00Z') - Date.parse(monday + 'T12:00:00Z')) / (7 * 86_400_000));
  return weeks % repeat.intervalWeeks === 0 && repeat.weekdays.includes(weekdayOf(day));
}

export function sameRepeat(a?: ChoreRepeat | null, b?: ChoreRepeat | null): boolean {
  const normalized = (r?: ChoreRepeat | null) => r ? [r.frequency, r.intervalWeeks,
    [...r.weekdays].sort().join(','), r.endsOn || null] : null;
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}
