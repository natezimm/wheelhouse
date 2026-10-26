import { describeRule, parseRule } from './repeat-rule';

describe('repeat rules', () => {
  it('says the rules Google and the screens write', () => {
    expect(describeRule('RRULE:FREQ=DAILY')).toBe('Every day');
    expect(describeRule('RRULE:FREQ=WEEKLY')).toBe('Every week');
    expect(describeRule('RRULE:FREQ=WEEKLY;BYDAY=TH,TU')).toBe('Every week on Tuesday and Thursday');
    expect(describeRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR')).toBe('Every 2 weeks on Monday, Wednesday and Friday');
    expect(describeRule('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('Every weekday');
    expect(describeRule('RRULE:FREQ=MONTHLY;BYMONTHDAY=15')).toBe('Every month on the 15th');
    expect(describeRule('RRULE:FREQ=MONTHLY;BYDAY=2TU')).toBe('Every month on the second Tuesday');
    expect(describeRule('RRULE:FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20270301T045959Z')).toBe('Every month on the last Friday, until Mar 1, 2027');
    expect(describeRule('RRULE:FREQ=YEARLY')).toBe('Every year');
    expect(describeRule('RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=4')).toBe('Every year on March 4');
    expect(describeRule('RRULE:FREQ=DAILY;INTERVAL=3;COUNT=10')).toBe('Every 3 days, 10 times');
  });

  it('falls back to "Repeats" for rules it does not understand', () => {
    expect(describeRule(null)).toBe('Repeats');
    expect(describeRule('RRULE:FREQ=HOURLY')).toBe('Repeats');
    expect(describeRule('RRULE:FREQ=WEEKLY;INTERVAL=0')).toBe('Repeats');
    expect(parseRule('RRULE:FREQ=WEEKLY;BYDAY=XX')).toBeNull();
  });

  it('reads an end date with or without a time', () => {
    expect(parseRule('RRULE:FREQ=DAILY;UNTIL=20261231')?.until).toBe('2026-12-31');
    expect(parseRule('FREQ=DAILY;UNTIL=20261231T235959Z')?.until).toBe('2026-12-31');
  });
});
