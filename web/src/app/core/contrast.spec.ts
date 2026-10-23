import { MEMBER_COLORS } from './family';

/** The design tokens, read from styles.css so this checks what the screens actually use. The tests run in Node. */
const fs = 'node:fs';
const { readFileSync } = await import(fs);
const css: string = readFileSync(`${(globalThis as any).process.cwd()}/src/styles.css`, 'utf8');

/** The declarations of the first rule whose selector starts with this text. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector}`);
  if (start < 0) throw new Error(`No ${selector} rule`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  return new Map([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const daylight = block(':root,\n[data-theme]');
const themes = {
  Daylight: daylight,
  Groovy: block("[data-theme='groovy']"),
  Classic: block("[data-theme='classic']"),
  Bold: block("[data-theme='bold']"),
  Night: block(':root[data-night]'),
};

type Theme = Map<string, string>;
/** A token's value in a theme, falling back to Daylight's as the cascade does, with var() resolved. */
function token(theme: Theme, name: string): string {
  const value = theme.get(name) ?? daylight.get(name);
  if (value === undefined) throw new Error(`No --${name} token`);
  const reference = value.match(/^var\(--([\w-]+)\)$/);
  return reference ? token(theme, reference[1]) : value;
}
const percent = (theme: Theme, name: string) => parseFloat(token(theme, name)) / 100;

type Rgb = [number, number, number];
const named: Record<string, string> = { black: '#000000', white: '#ffffff' };
const rgb = (color: string): Rgb => {
  const hex = named[color] ?? color;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Not a color: ${color}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
};
const color = (theme: Theme, name: string) => rgb(token(theme, name));
/** color-mix(in srgb, a share, b): a straight blend of the encoded channels. */
const mix = (a: Rgb, share: number, b: Rgb): Rgb => a.map((v, i) => v * share + b[i] * (1 - share)) as Rgb;
const luminance = (value: Rgb) => {
  const [r, g, b] = value.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

/** The colors a member can pick, and the demo family's own. The family's own color is a token. */
const colors = [...MEMBER_COLORS.map((c) => c.value), '#2563EB', '#0D9488', '#D97706', '#DB2777'];

describe.each(Object.entries(themes))('contrast, in the %s theme', (_, theme) => {
  describe.each([...colors, 'family'])('for the member color %s', (name) => {
    const member = name === 'family' ? color(theme, 'family') : rgb(name);
    const shade = mix(member, percent(theme, 'member-shade'), rgb('black'));
    const fill = mix(member, percent(theme, 'member-fill'), color(theme, 'member-fill-base'));
    const chip = mix(member, percent(theme, 'member-chip'), color(theme, 'member-chip-base'));
    const time = mix(member, percent(theme, 'event-time-mix'), color(theme, 'event-time-base'));
    const text = mix(member, percent(theme, 'member-text-mix'), color(theme, 'member-text-base'));

    it('gives white initials on an avatar at least 4.5:1', () => {
      expect(contrast(color(theme, 'on-avatar'), shade)).toBeGreaterThanOrEqual(4.5);
    });

    it('gives an event’s time, title and place at least 4.5:1 on the event’s fill', () => {
      expect(contrast(time, fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color(theme, 'event-ink'), fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color(theme, 'event-quiet'), fill)).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps a chip’s name, and a hidden chip’s initial on the ground, at 4.5:1', () => {
      expect(contrast(color(theme, 'ink'), chip)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(text, color(theme, 'ground'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(text, color(theme, 'surface'))).toBeGreaterThanOrEqual(4.5);
    });
  });

  it.each([
    ['text on the calendar', 'ink', 'surface'],
    ['hour labels and day names', 'faint', 'surface'],
    ['hour labels on today’s column', 'faint', 'today-tint'],
    ['day names over today', 'today-dow', 'today-head'],
    ['a day outside the month', 'faint', 'month-outside'],
    ['secondary text on the ground', 'muted', 'ground'],
    ['an unselected view', 'quiet', 'track'],
    ['the selected view', 'on-segment', 'segment'],
    ['a primary button', 'on-primary', 'primary'],
    ['today’s number', 'on-today-num', 'today-num'],
    ['the now line’s time', 'on-now', 'now-label'],
    ['the phone’s now time', 'now-text', 'ground'],
    ['the reconnecting pill', 'reconnecting-ink', 'reconnecting'],
    ['the failed pill', 'failed-ink', 'failed'],
    ['the notice pill', 'notice-ink', 'notice'],
    ['the save toast', 'on-ink', 'ink'],
    ['Delete in the details', 'danger-text', 'surface'],
  ])('keeps %s at 4.5:1', (_, text, background) => {
    expect(contrast(color(theme, text), color(theme, background))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the now line at 3:1 against the calendar, as a graphic, by its color or its edge', () => {
    const edge = token(theme, 'now-edge');
    const line = edge === 'transparent' ? color(theme, 'now') : rgb(edge);
    expect(contrast(line, color(theme, 'surface'))).toBeGreaterThanOrEqual(3);
  });
});
