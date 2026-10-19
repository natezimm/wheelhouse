import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Chore } from '../core/chores';
import { Clock } from '../core/clock';
import { FamilyStore } from '../core/family';
import { marlowes } from '../testing/marlowes';
import { TodayChores } from './today-chores';

const day = '2026-11-01';
const chore: Chore = { id: 'one', creationId: 'create', title: 'Water plants', notes: null,
  memberId: null, dueDate: '2026-10-31', completedAt: null, archived: false, version: 'v1' };

describe('Today chores', () => {
  let http: HttpTestingController;
  let now: ReturnType<typeof signal<Date>>;
  const read = () => http.expectOne(r => r.url === '/api/chores');
  beforeEach(() => {
    now = signal(new Date('2026-11-02T04:59:59Z')); // Still Nov 1 in New York, after the DST change.
    TestBed.configureTestingModule({ imports: [TodayChores], providers: [provideHttpClient(), provideHttpClientTesting(),
      provideRouter([]), { provide: Clock, useValue: { now } }] });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(FamilyStore).load(); http.expectOne('/api/family').flush(marlowes);
  });
  afterEach(() => http.verify());

  it('shows current counts and rolls back a refused quick completion without losing other work', async () => {
    const fixture = TestBed.createComponent(TodayChores); fixture.detectChanges();
    const done = { ...chore, id: 'done', creationId: 'done-key', title: 'Set the table', dueDate: day, completedAt: '2026-11-02T01:00:00Z' };
    read().flush({ changeNumber: 1, chores: [chore, done], canManage: true });
    fixture.detectChanges(); const page: HTMLElement = fixture.nativeElement;
    expect(page.textContent).toContain('1 of 2 done · 1 remaining');
    expect(page.textContent).toContain('1 overdue');
    page.querySelector<HTMLButtonElement>('[aria-label="Complete Water plants"]')!.click(); fixture.detectChanges();
    // A finished overdue one-time chore leaves today's active workload.
    expect(page.textContent).toContain('1 of 1 done');
    http.expectOne('/api/chores/one/completion').flush({}, { status: 403, statusText: 'Forbidden' });
    await Promise.resolve(); await Promise.resolve();
    read().flush({ changeNumber: 1, chores: [chore, done], canManage: true }); fixture.detectChanges();
    expect(page.textContent).toContain('1 of 2 done');
    expect(page.textContent).toContain('not saved');
  });

  it('rolls to the next household day at midnight rather than the browser or UTC day', () => {
    const fixture = TestBed.createComponent(TodayChores); fixture.detectChanges();
    const initial = read(); expect(initial.request.params.get('date')).toBe(day);
    initial.flush({ changeNumber: 1, chores: [chore], canManage: true }); fixture.detectChanges();
    now.set(new Date('2026-11-02T05:00:00Z')); fixture.detectChanges();
    const next = read(); expect(next.request.params.get('date')).toBe('2026-11-02');
    next.flush({ changeNumber: 1, chores: [], canManage: true }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No chores due today');
  });
});
