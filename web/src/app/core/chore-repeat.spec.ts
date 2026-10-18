import { repeatOn, sameRepeat } from './chore-repeat';

describe('chore recurrence dates', () => {
  const weekly = { frequency: 'Weekly' as const, intervalWeeks: 2, weekdays: [1, 3], endsOn: '2026-11-04' };
  it.each([
    ['2026-10-18', false], ['2026-10-19', true], ['2026-10-21', true], ['2026-10-26', false],
    ['2026-11-02', true], ['2026-11-04', true], ['2026-11-16', false],
  ])('projects %s without browser-zone shifts', (day, scheduled) => {
    expect(repeatOn(weekly, '2026-10-19', day)).toBe(scheduled);
  });
  it('keeps daily dates across daylight-saving changes and includes the end date', () => {
    const daily = { frequency: 'Daily' as const, intervalWeeks: 1, weekdays: [], endsOn: '2026-03-09' };
    expect(repeatOn(daily, '2026-03-07', '2026-03-07')).toBe(true);
    expect(repeatOn(daily, '2026-03-07', '2026-03-08')).toBe(true);
    expect(repeatOn(daily, '2026-03-07', '2026-03-09')).toBe(true);
    expect(repeatOn(daily, '2026-03-07', '2026-03-10')).toBe(false);
  });
  it('compares saved schedules by values rather than array references', () => {
    expect(sameRepeat(weekly, { ...weekly, weekdays: [3, 1] })).toBe(true);
    expect(sameRepeat(weekly, { ...weekly, intervalWeeks: 1 })).toBe(false);
    expect(sameRepeat(null, undefined)).toBe(true);
  });
});
