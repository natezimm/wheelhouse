import { Component, computed, inject, input } from '@angular/core';
import { CalendarStore, FAMILY, FAMILY_COLOR } from '../core/calendar';
import { FamilyStore } from '../core/family';
import { AvatarFace } from './avatar-face';

/**
 * A chip per person, plus one for the whole family's calendar, that shows or hides their
 * events. Sized for the wall; add the <code>compact</code> class for the phone, or set
 * <code>avatars</code> for the desktop toolbar.
 */
@Component({
  selector: 'app-calendar-filter',
  imports: [AvatarFace],
  template: `
    @for (chip of chips(); track chip.owner) {
      <button
        type="button"
        [attr.aria-pressed]="!calendar.hidden().has(chip.owner)"
        [style.--member]="chip.color"
        [attr.aria-label]="avatars() ? chip.name : null"
        [attr.title]="avatars() ? chip.name : null"
        (click)="calendar.toggle(chip.owner)"
      >
        <span class="mark" [class.art]="!!chip.avatar" aria-hidden="true"
          ><app-avatar-face [initial]="chip.initial" [avatar]="chip.avatar" [muted]="calendar.hidden().has(chip.owner)"
        /></span>
        @if (!avatars()) {
          {{ chip.name }}
        }
      </button>
    }
  `,
  host: { role: 'group', 'aria-label': 'Show calendars for', '[class.avatars]': 'avatars()' },
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    button {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 56px;
      box-sizing: border-box;
      padding: 0 20px 0 9px;
      border: var(--chip-border);
      border-radius: 28px;
      background: var(--member-chip-bg);
      color: var(--ink);
      font: 600 18px var(--font-body);
      white-space: nowrap;
      cursor: pointer;
    }

    .mark {
      flex-shrink: 0;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: var(--member-strong);
      border: var(--avatar-border);
      box-sizing: border-box;
      color: var(--on-avatar);
      font-size: 17px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* A hidden person's chip goes plain, with their color as an outline. */
    button[aria-pressed='false'] {
      border-color: var(--line);
      background: transparent;
      box-shadow: inset 0 0 0 2px var(--line);
      color: var(--muted);
    }

    button[aria-pressed='false'] .mark {
      background: transparent;
      border: 0;
      box-shadow: inset 0 0 0 2px var(--member-text);
      color: var(--member-text);
    }

    /* A hidden member's picture fades to grey inside their ring. */
    button[aria-pressed='false'] .mark.art {
      padding: 3px;
    }

    /* The phone: one row that scrolls sideways. */
    :host(.compact) {
      flex-wrap: nowrap;
      gap: 6px;
      overflow-x: auto;
      scrollbar-width: none;
    }

    :host(.compact) button {
      flex-shrink: 0;
      height: 44px;
      gap: 7px;
      padding: 0 14px 0 8px;
      border-radius: 22px;
      font-size: 15px;
    }

    :host(.compact) .mark {
      width: 28px;
      height: 28px;
      font-size: 13px;
    }

    /* The desktop toolbar: just the avatars, each named for screen readers and on hover. */
    :host(.avatars) {
      flex-wrap: nowrap;
      gap: 2px;
    }

    :host(.avatars) button {
      width: 44px;
      height: 44px;
      padding: 0;
      justify-content: center;
      border: 0;
      background: transparent;
    }

    :host(.avatars) .mark {
      width: 34px;
      height: 34px;
      font-size: 15px;
    }

    :host(.avatars) button[aria-pressed='false'] {
      box-shadow: none;
    }
  `,
})
export class CalendarFilter {
  /** Initials only, for a narrow toolbar. */
  readonly avatars = input(false);
  protected readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);

  protected readonly chips = computed(() => [
    ...this.family.members().map((member) => ({
      owner: member.id,
      name: member.displayName,
      initial: member.initial,
      avatar: member.avatar ?? null,
      color: member.color,
    })),
    ...(this.calendar.hasFamilyCalendar() ? [{ owner: FAMILY, name: 'Family', initial: 'F', avatar: null, color: FAMILY_COLOR }] : []),
  ]);
}
