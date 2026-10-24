import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject } from '@angular/core';
import { Clock } from './clock';
import { minutesIn } from './days';
import { Family, FamilyStore, NightMode, Theme } from './family';

/** The themes a family can choose, in the order Settings offers them. */
export const THEMES: readonly { value: Theme; name: string; about: string }[] = [
  { value: 'Daylight', name: 'Daylight', about: 'Soft and airy, with pastel events' },
  { value: 'Groovy', name: 'Groovy', about: 'Warm 70s paper with ink outlines' },
  { value: 'Classic', name: 'Classic', about: 'A clean office calendar with solid events' },
  { value: 'Bold', name: 'Bold', about: 'Black outlines, yellow highlights, mono times' },
];

/** When screens turn dark, in the order Settings offers them. */
export const NIGHT_MODES: readonly { value: NightMode; name: string }[] = [
  { value: 'Off', name: 'Off' },
  { value: 'AtNight', name: 'At night' },
  { value: 'Always', name: 'Always' },
];

/**
 * The fonts each theme needs beyond Outfit and Figtree, which index.html loads for Daylight.
 * A theme's fonts load only once it is in use, or previewed. Its dark look uses the same fonts.
 */
const FONTS: Partial<Record<Theme, string>> = {
  Groovy: 'family=Fraunces:opsz,wght,SOFT@9..144,500..800,100&family=DM+Sans:wght@400;500;600;700',
  Classic: 'family=Roboto:wght@400;500;700&family=Roboto+Flex:opsz,wght@8..144,400..600',
  Bold: 'family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600;700',
};

/** The browser's own color around the page, such as a phone's status bar: each look's ground, light and dark. */
const GROUNDS: Record<Theme, [light: string, dark: string]> = {
  Daylight: ['#f4f2ee', '#14161a'],
  Groovy: ['#f3e7d3', '#1e1611'],
  Classic: ['#ffffff', '#131314'],
  Bold: ['#efefe6', '#161616'],
};

/** Minutes since midnight of a time written HH:mm or HH:mm:ss. */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Whether screens are dark now: always, never, or at night on the family's clock, from
 * nightModeFrom up to, not including, nightModeTo.
 */
export function isNight(family: Family, now: Date): boolean {
  if (family.nightMode !== 'AtNight') return family.nightMode === 'Always';
  const from = minutesOf(family.nightModeFrom);
  const to = minutesOf(family.nightModeTo);
  const minute = minutesIn(family.timeZone, now);
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/**
 * Dresses every screen in the family's theme: <html data-theme> picks its tokens in styles.css,
 * and data-night turns on that theme's dark look, always or during the family's night hours, as
 * the family chose. It follows the family store, so a theme a parent picks on their phone reaches
 * the wall at its next family check.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);
  private readonly loaded = new Set<Theme>();

  /** The family's chosen theme; Daylight until a family is known. */
  readonly theme = computed<Theme>(() => this.family.family()?.theme ?? 'Daylight');

  /** Whether the dark look is on now. At night it changes only as the family's clock crosses its night hours. */
  readonly night = computed(() => {
    const family = this.family.family();
    return !!family && isNight(family, this.clock.now());
  });

  constructor() {
    effect(() => {
      const theme = this.theme();
      const night = this.night();
      const root = this.document.documentElement;
      root.dataset['theme'] = theme.toLowerCase();
      root.toggleAttribute('data-night', night);
      this.loadFonts(theme);
      this.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', GROUNDS[theme][night ? 1 : 0]);
    });
  }

  /** Loads a theme's fonts, once. Settings loads every theme's for its previews. */
  loadFonts(theme: Theme): void {
    const families = FONTS[theme];
    if (!families || this.loaded.has(theme)) return;
    this.loaded.add(theme);
    const link = this.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    link.dataset['fonts'] = theme.toLowerCase();
    this.document.head.appendChild(link);
  }
}
