import { Chore } from './chores';
import { choreProgress, matchesChoreStatus } from './chore-overview';

const chore: Chore = { id: '1', creationId: '1', title: 'Water plants', notes: null, memberId: null,
  dueDate: '2026-10-31', completedAt: null, archived: false, version: '1' };

describe('chore overview', () => {
  it('counts overdue one-time work once and excludes archived/hidden rows from progress', () => {
    const rows = [chore, { ...chore, id: 'done', completedAt: '2026-11-01T12:00:00Z' },
      { ...chore, id: 'archive', archived: true }, { ...chore, id: 'hidden', visible: false }];
    expect(choreProgress(rows, '2026-11-01')).toEqual({ total: 2, done: 1, remaining: 1, overdue: 1 });
  });
  it('keeps missed, remaining, archived and completed filters distinct', () => {
    expect(matchesChoreStatus(chore, 'remaining')).toBe(true);
    expect(matchesChoreStatus(chore, 'missed')).toBe(false);
    expect(matchesChoreStatus({ ...chore, missed: true }, 'missed')).toBe(true);
    expect(matchesChoreStatus({ ...chore, archived: true }, 'remaining')).toBe(false);
    expect(matchesChoreStatus({ ...chore, seriesArchived: true }, 'archived')).toBe(true);
    expect(matchesChoreStatus({ ...chore, completedAt: '2026-11-01T12:00:00Z', archived: true }, 'completed')).toBe(true);
  });
});
