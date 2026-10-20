import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Clock } from '../core/clock';
import { FamilyStore } from '../core/family';
import { MEAL_SLOTS } from '../core/meals';
import { HouseholdLive } from '../core/household-live';
import { marlowes } from '../testing/marlowes';
import { TodayMeals } from './today-meals';

describe('Today meals', () => {
  let http: HttpTestingController; let now: ReturnType<typeof signal<Date>>;
  beforeEach(() => {
    now = signal(new Date('2026-11-02T04:59:59Z'));
    TestBed.configureTestingModule({ imports:[TodayMeals], providers:[provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide:Clock, useValue:{ now } }, { provide:FamilyStore, useValue:{ family:signal(marlowes) } },
      { provide:HouseholdLive, useValue:{ state:signal('connected') } }] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('shows all slots separately and rolls over at household midnight after DST', async () => {
    const fixture = TestBed.createComponent(TodayMeals); fixture.detectChanges();
    const read = http.expectOne(r => r.url === '/api/meals'); expect(read.request.params.get('from')).toBe('2026-11-01');
    read.flush({ from:'2026-11-01', to:'2026-11-02', changeNumber:1, meals:MEAL_SLOTS.map(slot => ({ date:'2026-11-01', slot, title:slot === 'Dinner' ? 'Soup' : null, notes:null, version:null })) });
    await fixture.whenStable(); expect(fixture.nativeElement.textContent).toContain('Soup'); expect(fixture.nativeElement.textContent).toContain('BreakfastNot planned');
    now.set(new Date('2026-11-02T05:00:00Z')); fixture.detectChanges();
    const next = http.expectOne(r => r.url === '/api/meals'); expect(next.request.params.get('from')).toBe('2026-11-02');
    next.flush({}, { status:503, statusText:'Unavailable' }); await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Could not refresh meals'); expect(fixture.nativeElement.textContent).not.toContain('Soup');
  });
});
