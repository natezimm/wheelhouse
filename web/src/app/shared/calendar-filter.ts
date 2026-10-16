import { Component, computed, inject } from '@angular/core';
import { CalendarStore, FAMILY, FAMILY_COLOR } from '../core/calendar';
import { FamilyStore } from '../core/family';

/**
 * A chip per person, plus one for the whole family's calendar, that shows or hides their
 * events. Sized for the wall; add the <code>compact</code> class for the phone.
 */
@Component({
  selector: 'app-calendar-filter',
  template: `
    @for (chip of chips(); track chip.owner) {
      <button
        type="button"
        [attr.aria-pressed]="!calendar.hidden().has(chip.owner)"
        [style.--member]="chip.color"
        (click)="calendar.toggle(chip.owner)"
      >
        <span class="mark" aria-hidden="true">{{ chip.initial }}</span>
        {{ chip.name }}
      </button>
    }
  `,
  host: { role: 'group', 'aria-label': 'Show calendars for' },
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    button {
      display: flex;
      align-items: center;
      gap: 9px;
      height: 56px;
      padding: 0 20px 0 11px;
      border: 0;
      border-radius: 28px;
      background: color-mix(in srgb, var(--member) 14%, white);
      color: var(--ink);
      font: 600 18px var(--font-body);
      cursor: pointer;
    }

    .mark {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: var(--member);
      color: #ffffff;
      font-size: 15px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* A hidden person's chip goes plain, with their color as an outline. */
    button[aria-pressed='false'] {
      background: transparent;
      box-shadow: inset 0 0 0 2px var(--line);
      color: var(--muted);
    }

    button[aria-pressed='false'] .mark {
      background: transparent;
      box-shadow: inset 0 0 0 2px var(--member);
      color: var(--member);
    }

    :host(.compact) {
      gap: 8px;
    }

    :host(.compact) button {
      height: 44px;
      gap: 6px;
      padding: 0 13px 0 8px;
      border-radius: 22px;
      font-size: 14px;
    }

    :host(.compact) .mark {
      width: 24px;
      height: 24px;
      font-size: 11px;
    }
  `,
})
export class CalendarFilter {
  protected readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);

  protected readonly chips = computed(() => [
    ...this.family.members().map((member) => ({
      owner: member.id,
      name: member.displayName,
      initial: member.initial,
      color: member.color,
    })),
    ...(this.calendar.hasFamilyCalendar() ? [{ owner: FAMILY, name: 'Family', initial: 'F', color: FAMILY_COLOR }] : []),
  ]);
}
