import { TestBed } from '@angular/core/testing';
import { VIEW_STORAGE_KEY, ViewPreferences } from './view-preferences';

describe('ViewPreferences', () => {
  let preferences: ViewPreferences;

  beforeEach(() => {
    localStorage.clear();
    preferences = TestBed.inject(ViewPreferences);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('opens a new device on Day on the phone and Week on a desktop and the wall', () => {
    expect(preferences.view('phone')).toBe('day');
    expect(preferences.view('desktop')).toBe('week');
    expect(preferences.view('wall')).toBe('week');
  });

  it('remembers each context on its own', () => {
    preferences.remember('phone', 'month');
    preferences.remember('desktop', 'day');

    expect(preferences.view('phone')).toBe('month');
    expect(preferences.view('desktop')).toBe('day');
    expect(preferences.view('wall')).toBe('week');
    expect(JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY)!)).toEqual({ phone: 'month', desktop: 'day' });
  });

  it('ignores what it cannot read, keeping what it can', () => {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ phone: 'agenda', desktop: 'month', wall: 3, other: 'day' }));

    expect(preferences.view('phone')).toBe('day');
    expect(preferences.view('desktop')).toBe('month');
    expect(preferences.view('wall')).toBe('week');

    localStorage.setItem(VIEW_STORAGE_KEY, '{not json');
    expect(preferences.view('desktop')).toBe('week');
    localStorage.setItem(VIEW_STORAGE_KEY, '["month"]');
    expect(preferences.view('desktop')).toBe('week');
  });

  it('falls back to the defaults when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });

    expect(() => preferences.remember('phone', 'month')).not.toThrow();
    expect(preferences.view('phone')).toBe('day');
  });
});
