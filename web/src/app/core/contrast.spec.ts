import { FAMILY_COLOR } from './calendar';
import { MEMBER_COLORS } from './family';

/** The design tokens, read from styles.css so this checks what the screens actually use. The tests run in Node. */
const fs = 'node:fs';
const { readFileSync } = await import(fs);
const css: string = readFileSync(`${(globalThis as any).process.cwd()}/src/styles.css`, 'utf8');
const token = (name: string) => {
  const found = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!found) throw new Error(`No --${name} token`);
  return found[1].trim();
};
const percent = (name: string) => parseFloat(token(name)) / 100;

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
/** color-mix(in srgb, a share, b): a straight blend of the encoded channels. */
const mix = (a: Rgb, share: number, b: Rgb): Rgb => a.map((v, i) => v * share + b[i] * (1 - share)) as Rgb;
const luminance = (color: Rgb) => {
  const [r, g, b] = color.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

const white = rgb('#ffffff');
const black = rgb('#000000');

/** The colors a member can pick, the family's, and the demo family's own. */
const colors = [...MEMBER_COLORS.map((c) => c.value), FAMILY_COLOR, '#2563EB', '#0D9488', '#D97706', '#DB2777'];

describe('contrast, in the Daylight theme', () => {
  describe.each(colors)('for the member color %s', (color) => {
    const member = rgb(color);
    const shade = mix(member, percent('member-shade'), black);
    const fill = mix(member, percent('member-fill'), rgb(token('surface')));
    const chip = mix(member, percent('member-chip'), rgb(token('surface')));

    it('gives white initials on an avatar at least 4.5:1', () => {
      expect(contrast(rgb(token('on-ink')), shade)).toBeGreaterThanOrEqual(4.5);
    });

    it('gives an event’s time label and its title at least 4.5:1 on the event’s fill', () => {
      expect(contrast(shade, fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(token('ink')), fill)).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps a chip’s name, and a hidden chip’s initial on the ground, at 4.5:1', () => {
      expect(contrast(rgb(token('ink')), chip)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(shade, rgb(token('ground')))).toBeGreaterThanOrEqual(4.5);
    });
  });

  it.each([
    ['hour labels and day names', 'faint', 'surface'],
    ['hour labels on today’s column', 'faint', 'today-tint'],
    ['a day outside the month', 'faint', 'month-outside'],
    ['secondary text on the ground', 'muted', 'ground'],
    ['an unselected view', 'quiet', 'track'],
    ['the now line’s time', 'on-ink', 'now-label'],
    ['the phone’s now time', 'now-text', 'ground'],
    ['the reconnecting pill', 'reconnecting-ink', 'reconnecting'],
    ['the failed pill', 'failed-ink', 'failed'],
    ['the notice pill', 'notice-ink', 'notice'],
    ['Delete in the details', 'danger-text', 'surface'],
  ])('keeps %s at 4.5:1', (_, text, background) => {
    expect(contrast(rgb(token(text)), rgb(token(background)))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the now line itself at 3:1 against the calendar, as a graphic', () => {
    expect(contrast(rgb(token('now')), white)).toBeGreaterThanOrEqual(3);
  });
});
