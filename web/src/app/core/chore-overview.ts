import { Chore } from './chores';
import { Day } from './days';

export type ChoreStatus = 'all' | 'remaining' | 'completed' | 'missed' | 'archived';

export function matchesChoreStatus(chore: Chore, status: ChoreStatus): boolean {
  switch (status) {
    case 'remaining': return !chore.archived && !chore.completedAt;
    case 'completed': return !!chore.completedAt;
    case 'missed': return !!chore.missed && !chore.completedAt;
    case 'archived': return chore.archived || !!chore.seriesArchived;
    default: return true;
  }
}

/** Progress counts the whole daily workload before display filters, including overdue one-offs. */
export function choreProgress(chores: readonly Chore[], today: Day) {
  const work = chores.filter(c => !c.archived && c.visible !== false);
  const done = work.filter(c => !!c.completedAt).length;
  return { total: work.length, done, remaining: work.length - done,
    overdue: work.filter(c => !c.repeat && !c.completedAt && c.dueDate < today).length };
}
