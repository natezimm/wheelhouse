import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Family, FamilyStore } from './family';

const marlowes: Family = {
  id: 'f1',
  name: 'The Marlowes',
  timeZone: 'America/New_York',
  weekStartsOn: 'Monday',
  members: [
    { id: 'm1', displayName: 'Ben', color: '#2F5FC4', initial: 'B', role: 'Parent' },
    { id: 'm2', displayName: 'Milo', color: '#137A6D', initial: 'M', role: 'Kid' },
  ],
};

describe('FamilyStore', () => {
  let store: FamilyStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    store = TestBed.inject(FamilyStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('has no members while loading', () => {
    expect(store.state()).toEqual({ status: 'loading' });
    expect(store.members()).toEqual([]);
  });

  it('holds the family and its members once loaded', () => {
    store.load();
    http.expectOne('/api/family').flush(marlowes);

    expect(store.state()).toEqual({ status: 'ready', family: marlowes });
    expect(store.members().map((member) => member.displayName)).toEqual(['Ben', 'Milo']);
  });

  it('is private when the server answers 401', () => {
    store.load();
    http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(store.state()).toEqual({ status: 'private' });
    expect(store.members()).toEqual([]);
  });

  it('is unavailable on any other failure', () => {
    store.load();
    http.expectOne('/api/family').flush(null, { status: 500, statusText: 'Server Error' });

    expect(store.state()).toEqual({ status: 'unavailable' });
  });
});
