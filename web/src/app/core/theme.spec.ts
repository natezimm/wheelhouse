import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { marlowes } from '../testing/marlowes';
import { FamilyStore } from './family';
import { ThemeService, isNight } from './theme';

describe('isNight', () => {
  // The Marlowes live in New York; night is 9:30 PM to 6:30 AM there, across midnight.
  const at = (instant: string) => new Date(instant);

  it('follows the family’s clock, not the browser’s', () => {
    expect(isNight(marlowes, at('2026-10-23T01:29:00Z'))).toBe(false); // 9:29 PM in New York
    expect(isNight(marlowes, at('2026-10-23T01:30:00Z'))).toBe(true); // 9:30 PM
    expect(isNight(marlowes, at('2026-10-23T04:00:00Z'))).toBe(true); // midnight
    expect(isNight(marlowes, at('2026-10-23T10:29:00Z'))).toBe(true); // 6:29 AM
    expect(isNight(marlowes, at('2026-10-23T10:30:00Z'))).toBe(false); // 6:30 AM
    expect(isNight({ ...marlowes, timeZone: 'Europe/Paris' }, at('2026-10-23T01:30:00Z'))).toBe(true); // 3:30 AM in Paris
    expect(isNight({ ...marlowes, timeZone: 'Europe/Paris' }, at('2026-10-23T10:30:00Z'))).toBe(false);
  });

  it('works for night hours that do not cross midnight', () => {
    const early = { ...marlowes, nightModeFrom: '01:00:00', nightModeTo: '05:00:00' };
    expect(isNight(early, at('2026-10-23T04:00:00Z'))).toBe(false); // midnight
    expect(isNight(early, at('2026-10-23T06:00:00Z'))).toBe(true); // 2 AM
    expect(isNight(early, at('2026-10-23T09:00:00Z'))).toBe(false); // 5 AM
  });

  it('never turns on when the family turned night mode off, and is always on when it chose Always', () => {
    expect(isNight({ ...marlowes, nightMode: 'Off' }, at('2026-10-23T04:00:00Z'))).toBe(false);
    expect(isNight({ ...marlowes, nightMode: 'Always' }, at('2026-10-23T16:00:00Z'))).toBe(true); // noon
  });
});

describe('ThemeService', () => {
  let http: HttpTestingController;
  let family: FamilyStore;
  const root = document.documentElement;

  beforeEach(() => {
    // Other specs share the document; start without their font links.
    document.querySelectorAll('link[data-fonts]').forEach((link) => link.remove());
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    family = TestBed.inject(FamilyStore);
  });

  afterEach(() => {
    vi.useRealTimers();
    root.removeAttribute('data-theme');
    root.removeAttribute('data-night');
    document.querySelectorAll('link[data-fonts]').forEach((link) => link.remove());
  });

  function load(change: Partial<typeof marlowes>) {
    family.load();
    http.expectOne('/api/family').flush({ ...marlowes, ...change });
    TestBed.tick();
  }

  it('dresses the page in the family’s theme and loads only that theme’s fonts', () => {
    vi.setSystemTime(new Date('2026-10-23T16:00:00Z')); // noon in New York
    TestBed.inject(ThemeService);
    TestBed.tick();
    expect(root.dataset['theme']).toBe('daylight');

    load({ theme: 'Groovy' });

    expect(root.dataset['theme']).toBe('groovy');
    expect(root.hasAttribute('data-night')).toBe(false);
    expect([...document.querySelectorAll<HTMLLinkElement>('link[data-fonts]')].map((l) => l.dataset['fonts'])).toEqual([
      'groovy',
    ]);
    expect(document.querySelector<HTMLLinkElement>('link[data-fonts]')!.href).toContain('family=Fraunces');
  });

  it('turns Night on as the family’s clock reaches its night hours, and off again in the morning', async () => {
    vi.setSystemTime(new Date('2026-10-23T01:29:30Z')); // 9:29:30 PM in New York
    TestBed.inject(ThemeService);
    load({ theme: 'Bold' });
    expect(root.hasAttribute('data-night')).toBe(false);

    await vi.advanceTimersByTimeAsync(31_000);
    TestBed.tick();
    expect(root.hasAttribute('data-night')).toBe(true);
    // The theme stays: data-night turns on its own dark look, in its own fonts.
    expect(root.dataset['theme']).toBe('bold');
    expect([...document.querySelectorAll<HTMLLinkElement>('link[data-fonts]')].map((l) => l.dataset['fonts'])).toEqual(['bold']);

    vi.setSystemTime(new Date('2026-10-23T10:30:30Z')); // 6:30:30 AM
    await vi.advanceTimersByTimeAsync(1_000);
    TestBed.tick();
    expect(root.hasAttribute('data-night')).toBe(false);
  });
});
