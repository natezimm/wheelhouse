import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { marlowes } from '../testing/marlowes';
import { CalendarStore } from './calendar';
import { FamilyStore } from './family';
import { SPLASH_FADE_MS, SPLASH_ID, SPLASH_LONGEST_MS, Splash } from './splash';

@Component({ template: '' })
class Blank {}

describe('Splash', () => {
  let http: HttpTestingController;
  let splash: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    splash = document.createElement('div');
    splash.id = SPLASH_ID;
    document.body.appendChild(splash);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: '', component: Blank },
          { path: 'wall', component: Blank },
          { path: 'settings', component: Blank },
        ]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    splash.remove();
    vi.useRealTimers();
  });

  /** Starts following, as the app's root does, then opens a screen. */
  async function open(url: string) {
    TestBed.runInInjectionContext(() => TestBed.inject(Splash).follow());
    await TestBed.inject(Router).navigateByUrl(url);
    TestBed.tick();
  }

  /** Lets the fade start (a frame) and finish. */
  function fade() {
    vi.advanceTimersByTime(20);
    vi.advanceTimersByTime(SPLASH_FADE_MS);
  }

  it('stays over the calendar until it has an answer, then fades and is removed', async () => {
    await open('/');
    TestBed.inject(FamilyStore).load();
    http.expectOne('/api/family').flush(marlowes);
    TestBed.tick();
    TestBed.inject(CalendarStore).show('2026-10-26', '2026-11-02');
    TestBed.tick();
    fade();
    expect(document.getElementById(SPLASH_ID)).not.toBeNull();

    http.expectOne((request) => request.url === '/api/calendar').flush({ calendars: [], events: [], changeNumber: 1 });
    TestBed.tick();
    expect(splash.getAttribute('aria-hidden')).toBe('true');
    fade();
    expect(document.getElementById(SPLASH_ID)).toBeNull();
  });

  it('leaves the wall at once when nobody is signed in, so it can offer pairing', async () => {
    await open('/wall');
    TestBed.inject(FamilyStore).load();
    http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
    TestBed.tick();
    fade();

    expect(document.getElementById(SPLASH_ID)).toBeNull();
  });

  it('leaves any other screen as soon as it opens', async () => {
    await open('/settings');
    fade();

    expect(document.getElementById(SPLASH_ID)).toBeNull();
  });

  it('never stays longer than a few seconds, so a slow screen can say it is loading', async () => {
    await open('/');
    vi.advanceTimersByTime(SPLASH_LONGEST_MS - 1);
    expect(splash.classList.contains('splash-leaving')).toBe(false);

    fade();
    expect(document.getElementById(SPLASH_ID)).toBeNull();
    http.match(() => true);
  });
});
