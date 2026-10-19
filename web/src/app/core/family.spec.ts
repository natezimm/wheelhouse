import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { marlowes } from '../testing/marlowes';
import { FamilyStore, refusalMessage } from './family';

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
    expect(store.members().map((member) => member.displayName)).toEqual(['Ben', 'Tess', 'Milo']);
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

  describe('once loaded', () => {
    const names = () => store.members().map((member) => member.displayName);

    beforeEach(() => {
      store.load();
      http.expectOne('/api/family').flush(marlowes);
    });

    it('replaces the family when settings are saved', () => {
      const { id, members, ...settings } = marlowes;
      const renamed = { ...marlowes, name: 'The Marlowe Crew' };

      store.saveSettings({ ...settings, name: 'The Marlowe Crew' }).subscribe();
      const request = http.expectOne({ method: 'PUT', url: '/api/family' });
      expect(request.request.body).toEqual({ ...settings, name: 'The Marlowe Crew' });
      request.flush(renamed);

      expect(store.state()).toEqual({ status: 'ready', family: renamed });
    });

    it('adds a new member at the end', () => {
      const ada = { id: 'm4', displayName: 'Ada', color: '#7243B8', initial: 'A', role: 'Kid' } as const;

      store.addMember({ displayName: 'Ada', color: '#7243B8', role: 'Kid' }).subscribe();
      http.expectOne({ method: 'POST', url: '/api/family/members' }).flush(ada);

      expect(names()).toEqual(['Ben', 'Tess', 'Milo', 'Ada']);
    });

    it('swaps in an updated member without moving them', () => {
      const miles = { ...marlowes.members[2], displayName: 'Miles' };

      store.updateMember('m3', { displayName: 'Miles', color: '#137A6D', role: 'Kid' }).subscribe();
      http.expectOne({ method: 'PUT', url: '/api/family/members/m3' }).flush(miles);

      expect(names()).toEqual(['Ben', 'Tess', 'Miles']);
    });

    it('drops a removed member', () => {
      store.removeMember('m3').subscribe();
      http.expectOne({ method: 'DELETE', url: '/api/family/members/m3' }).flush(null);

      expect(names()).toEqual(['Ben', 'Tess']);
    });

    it('changes nothing when the server refuses', () => {
      let failed = false;

      store.removeMember('m1').subscribe({ error: () => (failed = true) });
      http
        .expectOne({ method: 'DELETE', url: '/api/family/members/m1' })
        .flush({ errors: { role: ['A family needs at least one parent.'] } }, { status: 400, statusText: 'Bad Request' });

      expect(failed).toBe(true);
      expect(names()).toEqual(['Ben', 'Tess', 'Milo']);
    });
  });
  it('ignores a previous identity read after sign-out or pairing discards the family', () => {
    store.load();
    const previous = http.expectOne('/api/family');
    store.forget();
    previous.flush(marlowes);
    expect(store.state().status).toBe('loading');
  });

});

describe('refusalMessage', () => {
  it("uses the server's first message", () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { errors: { role: ['A family needs at least one parent.'] } },
    });

    expect(refusalMessage(error, 'fallback')).toBe('A family needs at least one parent.');
  });

  it('falls back when the server gave none', () => {
    expect(refusalMessage(new HttpErrorResponse({ status: 500 }), 'fallback')).toBe('fallback');
    expect(refusalMessage(new Error('offline'), 'fallback')).toBe('fallback');
  });


});
