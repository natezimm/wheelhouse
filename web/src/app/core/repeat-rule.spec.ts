import { canonicalRule, describeRule, followDay, formatRule, parseRule, placeInMonth, presetOf, presetsFor, ruleDays } from './repeat-rule';

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

  it('reads an end given as an instant as the family’s own day', () => {
    // The API ends a timed series at the end of the family's last day, here in New York.
    expect(parseRule('RRULE:FREQ=WEEKLY;UNTIL=20270116T045959Z', 'America/New_York')?.until).toBe('2027-01-15');
    expect(describeRule('RRULE:FREQ=WEEKLY;UNTIL=20270116T045959Z', 'America/New_York')).toBe('Every week, until Jan 15, 2027');
  });

  it('offers the usual repeats named from the first day', () => {
    // Tuesday, October 27, 2026 is the month's last Tuesday.
    expect(placeInMonth('2026-10-27')).toBe(-1);
    expect(placeInMonth('2026-10-13')).toBe(2);
    expect(presetsFor('2026-10-27').map((p) => [p.label, p.rule])).toEqual([
      ['Does not repeat', null],
      ['Every day', 'RRULE:FREQ=DAILY'],
      ['Every weekday (Monday to Friday)', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
      ['Every week on Tuesday', 'RRULE:FREQ=WEEKLY;BYDAY=TU'],
      ['Every month on the 27th', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=27'],
      ['Every month on the last Tuesday', 'RRULE:FREQ=MONTHLY;BYDAY=-1TU'],
      ['Every year on October 27', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=27'],
    ]);
  });

  it('writes rules one way, so a rule Google wrote matches the repeat it is', () => {
    expect(canonicalRule('RRULE:FREQ=WEEKLY', '2026-10-27')).toBe('RRULE:FREQ=WEEKLY;BYDAY=TU');
    expect(canonicalRule('RRULE:FREQ=MONTHLY', '2026-10-27')).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=27');
    expect(canonicalRule('RRULE:FREQ=WEEKLY;BYDAY=FR,MO;INTERVAL=1', '2026-10-27')).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,FR');
    expect(presetOf('RRULE:FREQ=YEARLY', '2026-10-27')?.id).toBe('yearly');
    expect(presetOf('RRULE:FREQ=WEEKLY;INTERVAL=2', '2026-10-27')).toBeNull();
    expect(presetOf(null, '2026-10-27')?.id).toBe('never');
    expect(formatRule(parseRule('RRULE:FREQ=DAILY;COUNT=5')!)).toBe('RRULE:FREQ=DAILY;COUNT=5');
  });

  it('lets a ready-made repeat follow a new first day, and keeps a custom one', () => {
    expect(followDay('RRULE:FREQ=WEEKLY;BYDAY=TU', '2026-10-27', '2026-10-28')).toBe('RRULE:FREQ=WEEKLY;BYDAY=WE');
    expect(followDay('RRULE:FREQ=MONTHLY;BYDAY=-1TU', '2026-10-27', '2026-10-13')).toBe('RRULE:FREQ=MONTHLY;BYDAY=2TU');
    expect(followDay('RRULE:FREQ=WEEKLY;BYDAY=MO,TU', '2026-10-27', '2026-10-28')).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,TU');
    expect(followDay(null, '2026-10-27', '2026-10-28')).toBeNull();
  });

  it('expands a rule as the API and Google do', () => {
    const days = (rule: string, first: string, from: string, to: string) => ruleDays(first, parseRule(rule)!, from, to);
    expect(days('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR', '2027-01-06', '2027-01-01', '2027-01-21'))
      .toEqual(['2027-01-06', '2027-01-08', '2027-01-18', '2027-01-20']);
    expect(days('RRULE:FREQ=MONTHLY;BYDAY=-1FR', '2027-01-29', '2027-01-01', '2027-05-01')).toEqual(['2027-01-29', '2027-02-26', '2027-03-26', '2027-04-30']);
    expect(days('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1', '2027-01-31', '2027-01-01', '2027-04-01')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(days('RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', '2028-02-29', '2028-01-01', '2033-01-01')).toEqual(['2028-02-29', '2032-02-29']);
    // A count includes the first event, even when it falls before the loaded days.
    expect(days('RRULE:FREQ=DAILY;COUNT=3', '2027-01-04', '2027-01-05', '2027-02-01')).toEqual(['2027-01-05', '2027-01-06']);
    expect(days('RRULE:FREQ=WEEKLY;UNTIL=20270117', '2027-01-04', '2027-01-01', '2027-02-01')).toEqual(['2027-01-04', '2027-01-11']);
  });
});
