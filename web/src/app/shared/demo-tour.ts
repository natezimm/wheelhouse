import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FamilyStore, Theme } from '../core/family';
import { THEMES, ThemeService } from '../core/theme';
import { playDragPreview, previewShift, showableEvent } from './drag-preview';
import { ModalFocus } from './modal-focus';

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** One stop on the tour: what it lights up on the screen, if anything, and what it says there. */
interface TourStep {
  title: string;
  text: string;
  /** The part of the screen it points at; a step whose part is not on the screen is left out. */
  target?: (document: Document) => HTMLElement | null;
  /** Something the step shows rather than says. */
  kind?: 'drag' | 'looks' | 'wall';
}

const first = (selector: string) => (document: Document) =>
  Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => element.getBoundingClientRect().height > 0) ?? null;

const PEOPLE: TourStep = {
  title: 'Everyone has a color',
  text: "Each person's events wear their color, everywhere. Tap someone to show only theirs.",
  target: first('main app-calendar-filter'),
};

const LOOKS: TourStep = {
  title: 'Make it yours',
  text: 'Pick a look and the whole calendar changes. At night it turns dark on its own.',
  kind: 'looks',
};

export const DESKTOP_TOUR: readonly TourStep[] = [
  {
    title: 'Three ways to see it',
    text: 'Day, Week and Month, a click apart. Keys work too: D, W and M, or ? for every shortcut.',
    target: first('app-calendar-toolbar .view-switch'),
  },
  PEOPLE,
  {
    title: 'Drag to move it',
    text: 'Grab an event and drop it on a new time, or pull its bottom edge to end it later. Click an empty half hour to add one.',
    target: showableEvent,
    kind: 'drag',
  },
  LOOKS,
  {
    title: 'And on the kitchen wall',
    text: 'The same calendar, made for a touch screen by the fridge. A phone pairs it with a 6-digit code.',
    kind: 'wall',
  },
];

export const PHONE_TOUR: readonly TourStep[] = [
  {
    title: 'Three ways to see it',
    text: 'Day, Week and Month. Your phone remembers the one you used last.',
    target: first('main .switch-bar .view-switch'),
  },
  PEOPLE,
  {
    title: 'Tap for the details',
    text: 'Every event opens to its time, place, notes and people, with Edit, Duplicate and Delete.',
    target: first('app-agenda-list li.event, app-compact-agenda button'),
  },
  {
    title: 'Add one in seconds',
    text: 'Tap + to add an event. It can repeat, count down to the day, or stay private.',
    target: first('main header .add'),
  },
  LOOKS,
];

const MARGIN = 16;
const GAP = 14;

/**
 * Where the tour's card goes: below what it points at, else above, else beside it, else along the
 * bottom of the screen, and always inside it. With nothing to point at it sits in the middle, or in
 * the bottom corner when the calendar behind it should show (a look being tried).
 */
export function placeCard(hole: Box | null, card: { width: number; height: number }, view: { width: number; height: number }, rest: 'middle' | 'corner'): { top: number; left: number } {
  const clampLeft = (left: number) => Math.max(MARGIN, Math.min(left, view.width - card.width - MARGIN));
  const clampTop = (top: number) => Math.max(MARGIN, Math.min(top, view.height - card.height - MARGIN));
  if (!hole) {
    return rest === 'middle'
      ? { top: clampTop((view.height - card.height) / 2), left: clampLeft((view.width - card.width) / 2) }
      : { top: clampTop(view.height - card.height - MARGIN), left: clampLeft(view.width - card.width - 2 * MARGIN) };
  }
  const centered = clampLeft(hole.left + hole.width / 2 - card.width / 2);
  const below = hole.top + hole.height + GAP;
  if (below + card.height <= view.height - MARGIN) return { top: below, left: centered };
  const above = hole.top - GAP - card.height;
  if (above >= MARGIN) return { top: above, left: centered };
  const right = hole.left + hole.width + GAP;
  if (right + card.width <= view.width - MARGIN) return { top: clampTop(hole.top), left: right };
  const left = hole.left - GAP - card.width;
  if (left >= MARGIN) return { top: clampTop(hole.top), left };
  return { top: clampTop(view.height - card.height - MARGIN), left: centered };
}

/**
 * The demo's guided tour: a few stops, each lighting up one part of the real calendar with a card
 * beside it, Next and Back moving the light across the screen. It shows rather than tells: the
 * drag stop plays a drag on an event (nothing is saved), and the looks stop puts a theme on the
 * visitor's copy so the calendar changes behind the card.
 */
@Component({
  selector: 'app-demo-tour',
  imports: [ModalFocus, RouterLink],
  host: { '(document:keydown)': 'key($event)', '(window:resize)': 'measure()', '(document:scroll)': 'measure()' },
  template: `
    <div class="veil" aria-hidden="true"></div>
    <div class="hole" aria-hidden="true" [class.clear]="!dim()" [class.lit]="!!hole()" [style.top.px]="spot().top" [style.left.px]="spot().left" [style.width.px]="spot().width" [style.height.px]="spot().height"></div>
    <section
      #card
      class="card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby="tour-text"
      tabindex="-1"
      appModalFocus
      [class.wide]="step().kind === 'wall'"
      [class.waiting]="!ready()"
      [style.top.px]="place().top"
      [style.left.px]="place().left"
    >
      <button type="button" class="close" aria-label="End the tour" (click)="closed.emit()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
      </button>
      <p class="count">{{ at() + 1 }} of {{ steps().length }}</p>
      <h2 id="tour-title">{{ step().title }}</h2>
      <p id="tour-text" class="text">{{ step().text }}</p>
      @if (step().kind === 'looks') {
        <div class="swatches" role="group" aria-label="Looks">
          @for (look of themes; track look.value) {
            <button type="button" class="swatch" [attr.data-theme]="look.value.toLowerCase()" [attr.aria-pressed]="look.value === current()" [disabled]="saving()" (click)="pick(look.value)">
              <span class="sample" aria-hidden="true"><span class="bar"></span><span class="bar short"></span></span>
              <span class="name">{{ look.name }}</span>
            </button>
          }
        </div>
      }
      @if (step().kind === 'wall') {
        <img class="wall" src="welcome-wall.webp" width="448" height="252" alt="The wall display's week" />
      }
      <div class="footer">
        <span class="dots" aria-hidden="true">
          @for (stop of steps(); track $index) {
            <span class="dot" [class.on]="$index === at()"></span>
          }
        </span>
        @if (at() > 0) {
          <button type="button" class="back" (click)="go(-1)">Back</button>
        }
        @if (last()) {
          @if (step().kind === 'wall') {
            <a class="next" routerLink="/wall" (click)="closed.emit()">Open the wall</a>
          } @else {
            <button type="button" class="next" (click)="closed.emit()">Done</button>
          }
        } @else {
          <button type="button" class="next" (click)="go(1)">Next</button>
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 25;
    }

    /* Holds the calendar still while the tour talks about it. */
    .veil {
      position: absolute;
      inset: 0;
    }

    /* The light: a rounded window in a dimmed screen, gliding from one stop to the next. */
    .hole {
      position: fixed;
      border-radius: 14px;
      box-shadow: 0 0 0 200vmax var(--scrim-strong);
      pointer-events: none;
      transition: top 0.45s cubic-bezier(0.2, 0.8, 0.2, 1), left 0.45s cubic-bezier(0.2, 0.8, 0.2, 1), width 0.45s cubic-bezier(0.2, 0.8, 0.2, 1), height 0.45s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.3s ease;
    }

    .hole.clear {
      box-shadow: 0 0 0 200vmax transparent;
    }

    .hole.lit::after {
      content: '';
      position: absolute;
      inset: -3px;
      border: 2px solid var(--accent);
      border-radius: inherit;
      animation: ring 1.8s ease-out infinite;
    }

    @keyframes ring {
      70%,
      100% {
        transform: scale(1.04);
        opacity: 0;
      }
    }

    .card {
      position: fixed;
      box-sizing: border-box;
      width: min(360px, calc(100vw - 32px));
      padding: 18px 20px 16px;
      border-radius: var(--card-radius);
      border: var(--card-border);
      background: var(--surface);
      box-shadow: var(--dialog-shadow);
      color: var(--ink);
      transition: top 0.45s cubic-bezier(0.2, 0.8, 0.2, 1), left 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
      animation: rise 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both;
      outline: none;
    }

    .card.waiting {
      visibility: hidden;
    }

    .card.wide {
      width: min(480px, calc(100vw - 32px));
    }

    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .hole,
      .card {
        transition: none;
        animation: none;
      }

      .hole.lit::after {
        animation: none;
      }
    }

    .close {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }

    .close:hover {
      background: var(--track);
      color: var(--ink);
    }

    .count {
      margin: 0 0 4px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
    }

    h2 {
      margin: 0 48px 6px 0;
      font-family: var(--font-display);
      font-size: 22px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      line-height: 1.2;
    }

    .text {
      margin: 0 0 14px;
      font-size: 15px;
      line-height: 1.45;
      color: var(--muted);
    }

    .swatches {
      margin: 0 0 14px;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }

    /* A swatch carries its own data-theme, so it is drawn in that look's tokens. */
    .swatch {
      min-height: 64px;
      padding: 6px 4px 5px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      border: var(--card-border);
      border-radius: var(--card-radius);
      background: var(--ground);
      color: var(--ink);
      font: 600 12px var(--font-body);
      cursor: pointer;
    }

    .swatch[aria-pressed='true'] {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .sample {
      width: 100%;
      height: 26px;
      box-sizing: border-box;
      padding: 5px 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      border-radius: var(--event-radius-small);
      background: var(--surface);
    }

    .bar {
      height: 6px;
      border-radius: 3px;
      background: var(--accent);
    }

    .bar.short {
      width: 60%;
      background: var(--line);
    }

    .wall {
      display: block;
      width: 100%;
      height: auto;
      margin: 0 0 14px;
      border-radius: var(--event-radius-small);
      box-shadow: var(--card-shadow);
    }

    .footer {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .dots {
      flex: 1;
      display: flex;
      gap: 6px;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--line);
      transition: width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    .dot.on {
      width: 20px;
      border-radius: 4px;
      background: var(--accent);
    }

    .back,
    .next {
      min-height: 44px;
      padding: 0 18px;
      display: inline-flex;
      align-items: center;
      border-radius: var(--pill);
      font: 600 15px var(--font-body);
      text-decoration: none;
      cursor: pointer;
    }

    .back {
      border: 0;
      background: transparent;
      color: var(--ink);
    }

    .next {
      border: var(--primary-border);
      background: var(--primary);
      color: var(--on-primary);
      box-shadow: var(--primary-shadow);
    }
  `,
})
export class DemoTour {
  readonly layout = input<'desktop' | 'phone'>('phone');
  readonly closed = output<void>();

  private readonly document = inject(DOCUMENT);
  private readonly family = inject(FamilyStore);
  private readonly look = inject(ThemeService);
  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');

  protected readonly themes = THEMES;
  protected readonly current = this.look.theme;
  protected readonly saving = signal(false);

  /**
   * The stops whose part of the screen is there, checked once the calendar has drawn (a desktop's
   * Month may just have turned to Week) and again when the window changes layout.
   */
  protected readonly steps = signal<readonly TourStep[]>(DESKTOP_TOUR);
  protected readonly ready = signal(false);
  protected readonly at = signal(0);
  protected readonly step = computed(() => this.steps()[Math.min(this.at(), this.steps().length - 1)]);
  protected readonly last = computed(() => this.at() >= this.steps().length - 1);
  /** Whether the screen behind dims: not while a look is tried, which should show. */
  protected readonly dim = computed(() => this.step().kind !== 'looks');

  /** The lit part of the screen, if the step points at one. */
  protected readonly hole = signal<Box | null>(null);
  private readonly cardSize = signal({ width: 360, height: 220 });
  private readonly viewSize = signal({ width: 0, height: 0 });

  /** With nothing to light, the window shrinks to the card's middle, so it grows from there to the next stop. */
  protected readonly spot = computed<Box>(() => {
    const view = this.viewSize();
    return this.hole() ?? { top: view.height / 2, left: view.width / 2, width: 0, height: 0 };
  });
  protected readonly place = computed(() =>
    placeCard(this.hole(), this.cardSize(), this.viewSize(), this.step().kind === 'looks' ? 'corner' : 'middle'),
  );

  private target: HTMLElement | null = null;
  private visit = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    for (const theme of THEMES) this.look.loadFonts(theme.value);
    effect(() => {
      const layout = this.layout();
      untracked(() => {
        this.steps.set(layout === 'desktop' ? DESKTOP_TOUR : PHONE_TOUR);
        this.ready.set(false);
      });
      // Two frames: the calendar's grid lays its events out once it knows its size.
      const view = this.document.defaultView;
      view?.requestAnimationFrame(() => view.requestAnimationFrame(() => this.check()));
    });
    effect(() => {
      const step = this.step();
      if (this.ready()) untracked(() => this.enter(step));
    });
    afterNextRender(() => {
      const card = this.card().nativeElement;
      const observer = new ResizeObserver(() => this.cardSize.set({ width: card.offsetWidth, height: card.offsetHeight }));
      observer.observe(card);
      this.stop = () => observer.disconnect();
    });
    inject(DestroyRef).onDestroy(() => {
      this.visit++;
      this.timers.forEach(clearTimeout);
      this.stop();
    });
  }

  private stop = () => {};

  private check(): void {
    this.steps.update((steps) => steps.filter((step) => !step.target || step.target(this.document)));
    this.at.update((at) => Math.min(at, this.steps().length - 1));
    this.ready.set(true);
  }

  protected go(by: number): void {
    this.at.update((at) => Math.max(0, Math.min(at + by, this.steps().length - 1)));
  }

  protected key(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit();
    } else if (event.key === 'ArrowRight' && !this.last()) {
      event.preventDefault();
      this.go(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.go(-1);
    }
  }

  /** Puts a look on the visitor's own copy, as Settings would; the calendar behind the card changes at once. */
  protected pick(theme: Theme): void {
    const family = this.family.family();
    if (!family || theme === family.theme) return;
    this.saving.set(true);
    this.family.saveTheme(theme, family.nightMode).subscribe({
      next: () => this.saving.set(false),
      error: () => this.saving.set(false),
    });
  }

  /** Follows the lit part as the page scrolls or the window resizes. */
  protected measure(): void {
    const view = this.document.defaultView;
    this.viewSize.set({ width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 });
    const target = this.target;
    if (!target?.isConnected) {
      this.hole.set(null);
      return;
    }
    const box = target.getBoundingClientRect();
    let top = box.top;
    let bottom = box.bottom;
    if (this.step().kind === 'drag') {
      // The light takes in the hour the copy slides to.
      const shift = previewShift(target, this.document);
      top = Math.min(top, box.top + shift);
      bottom = Math.max(bottom, box.bottom + shift);
    }
    const pad = 6;
    this.hole.set({ top: top - pad, left: box.left - pad, width: box.width + 2 * pad, height: bottom - top + 2 * pad });
  }

  private enter(step: TourStep): void {
    const visit = ++this.visit;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.target = step.target?.(this.document) ?? null;
    const reduced = this.document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    this.measure();
    // A smooth scroll moves the part for a moment; follow it until it settles.
    for (const wait of [120, 300, 600]) this.timers.push(setTimeout(() => this.measure(), wait));
    this.timers.push(setTimeout(() => this.card().nativeElement.querySelector<HTMLElement>('.next')?.focus({ preventScroll: true })));
    if (step.kind === 'drag' && this.target) {
      const block = this.target;
      const play = () => {
        if (visit !== this.visit || !block.isConnected) return;
        void playDragPreview(block, this.document).then(() => {
          if (visit === this.visit) this.timers.push(setTimeout(play, 900));
        });
      };
      this.timers.push(setTimeout(play, reduced ? 0 : 500));
    }
  }
}
