import { Component, computed, inject, input } from '@angular/core';
import { FAMILY_COLOR } from '../core/calendar';
import { CountdownStore } from '../core/countdowns';
import { FamilyStore } from '../core/family';

/**
 * The events the family counts down to, each a chip in its owner's color with the days left:
 * in the wall's toolbar, and above the phone's day. Nothing shows until an event is marked.
 */
@Component({
  selector: 'app-countdown-strip',
  host: { '[class]': 'layout()' },
  template: `
    @if (chips().length) {
      <ul aria-label="Counting down to">
        @for (chip of chips(); track chip.id) {
          <li [style.--member]="chip.color" [attr.aria-label]="chip.title + ', ' + (chip.days <= 0 ? 'today' : chip.days === 1 ? 'tomorrow' : 'in ' + chip.left)">
            <span class="left">{{ chip.left }}</span>
            <span class="title">{{ chip.title }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      gap: 8px;
      min-width: 0;
      overflow: hidden;
    }

    li {
      min-width: 0;
      height: 44px;
      padding: 0 16px 0 6px;
      box-sizing: border-box;
      border-radius: var(--pill);
      background: var(--member-chip-bg);
      color: var(--ink);
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
    }

    .left {
      flex-shrink: 0;
      height: 32px;
      padding: 0 12px;
      border-radius: var(--pill);
      background: var(--member-strong);
      color: var(--on-avatar);
      font-weight: 800;
      display: flex;
      align-items: center;
      white-space: nowrap;
    }

    .title {
      min-width: 0;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    :host(.phone) ul {
      overflow-x: auto;
      scrollbar-width: none;
    }

    :host(.phone) li {
      flex-shrink: 0;
      height: 36px;
      max-width: 75%;
      font-size: 14px;
    }

    :host(.phone) .left {
      height: 26px;
      padding: 0 10px;
    }
  `,
})
export class CountdownStrip {
  readonly layout = input<'wall' | 'phone'>('wall');

  private readonly countdowns = inject(CountdownStore);
  private readonly family = inject(FamilyStore);

  protected readonly chips = computed(() => {
    const members = this.family.family()?.members ?? [];
    return this.countdowns.countdowns().map((c) => ({
      ...c,
      color: members.find((m) => m.id === c.memberId)?.color ?? FAMILY_COLOR,
    }));
  });
}
