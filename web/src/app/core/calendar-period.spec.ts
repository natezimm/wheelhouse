import { periodOf, stepFrom } from './calendar-period';

describe('calendar periods', () => {
  const today = '2026-10-22';

  it('names a week from the family’s first day, with the year apart', () => {
    expect(periodOf('week', today, today, 'Monday')).toEqual({
      start: '2026-10-19',
      end: '2026-10-26',
      title: 'October 19 – 25',
      brief: 'Oct 19 – 25',
      year: '2026',
      unit: 'week',
      isCurrent: true,
    });
    expect(periodOf('week', today, today, 'Sunday').title).toBe('October 18 – 24');
    expect(periodOf('week', '2026-10-29', today, 'Monday')).toMatchObject({ title: 'October 26 – November 1', brief: 'Oct 26 – Nov 1', isCurrent: false });
    expect(periodOf('week', '2026-12-30', today, 'Monday')).toMatchObject({ title: 'December 28, 2026 – January 3', year: '2027' });
  });

  it('names a day and a month', () => {
    expect(periodOf('day', '2026-10-23', today, 'Monday')).toMatchObject({
      start: '2026-10-23',
      end: '2026-10-24',
      title: 'Friday, October 23',
      brief: 'Fri, Oct 23',
      unit: 'day',
      isCurrent: false,
    });
    expect(periodOf('month', '2026-10-05', today, 'Monday')).toMatchObject({
      start: '2026-10-01',
      end: '2026-11-01',
      title: 'October',
      brief: 'October',
      year: '2026',
      isCurrent: true,
    });
  });

  it('steps by a day, a week, or a month that keeps the date when it can', () => {
    expect(stepFrom('day', '2026-12-31', 1)).toBe('2027-01-01');
    expect(stepFrom('week', today, -1)).toBe('2026-10-15');
    expect(stepFrom('month', '2026-01-31', 1)).toBe('2026-02-28');
    expect(stepFrom('month', '2026-03-15', -1)).toBe('2026-02-15');
  });
});
