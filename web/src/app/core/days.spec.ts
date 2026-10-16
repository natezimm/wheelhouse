import { addDays, addMonths, dayIn, daysBetween, formatDay, startOfWeek, timeIn, weekdayOf } from './days';

describe('days', () => {
  it("finds the family's day for an instant, whatever the browser's zone", () => {
    // 02:30 UTC on the 13th is still the evening of the 12th in New York.
    expect(dayIn('America/New_York', '2026-10-13T02:30:00Z')).toBe('2026-10-12');
    expect(dayIn('Europe/Paris', '2026-10-13T02:30:00Z')).toBe('2026-10-13');
  });

  it("writes an instant's time in the family's zone", () => {
    expect(timeIn('America/New_York', '2026-10-12T19:30:00Z')).toBe('3:30 PM');
  });

  it('counts days across a month end and a daylight-saving change', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });

  it("starts a week on the family's chosen day", () => {
    expect(weekdayOf('2026-10-15')).toBe(4);
    expect(startOfWeek('2026-10-15', 'Monday')).toBe('2026-10-12');
    expect(startOfWeek('2026-10-15', 'Sunday')).toBe('2026-10-11');
    expect(startOfWeek('2026-10-11', 'Monday')).toBe('2026-10-05');
  });

  it('moves by whole months from the first of the month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
  });

  it('writes a day for people', () => {
    expect(formatDay('2026-10-12', { weekday: 'short', month: 'short', day: 'numeric' })).toBe('Mon, Oct 12');
  });
});
