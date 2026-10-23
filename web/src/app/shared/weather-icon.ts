import { Component, input } from '@angular/core';
import { WeatherIcon as Icon } from '../core/weather';

/** A line drawing for today's weather. It takes the size of its host. */
@Component({
  selector: 'app-weather-icon',
  template: `
    <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @switch (icon()) {
        @case ('Sun') {
          <g class="sun">
            <circle cx="12" cy="12" r="4"></circle>
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"></path>
          </g>
        }
        @case ('Moon') {
          <path class="cloud" d="M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z"></path>
        }
        @case ('PartlyCloudy') {
          <g class="sun">
            <circle cx="9" cy="9" r="3.5"></circle>
            <path d="M9 2.5v1.2M3.3 9H2.1M4.6 4.6l.9.9M13.4 4.6l-.9.9"></path>
          </g>
          <path class="cloud" d="M8 19h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.6A2.8 2.8 0 0 0 8 19z"></path>
        }
        @case ('Fog') {
          <path class="cloud" d="M4 8h16M3 12h18M5 16h14M8 20h8"></path>
        }
        @case ('Rain') {
          <path class="cloud" [attr.d]="raisedCloud"></path>
          <path class="wet" d="M9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5"></path>
        }
        @case ('Snow') {
          <path class="cloud" [attr.d]="raisedCloud"></path>
          <path class="wet" d="M9 18.5h.01M13 18.5h.01M17 18.5h.01M11 21h.01M15 21h.01" stroke-width="2.4"></path>
        }
        @case ('Storm') {
          <path class="cloud" [attr.d]="raisedCloud"></path>
          <path class="sun" d="M13 15.5l-2 3h3l-2 3"></path>
        }
        @default {
          <path class="cloud" d="M7 19h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.8A3.1 3.1 0 0 0 7 19z"></path>
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      width: 24px;
      height: 24px;
    }

    svg {
      width: 100%;
      height: 100%;
    }

    .sun {
      stroke: var(--warn);
    }

    .cloud {
      stroke: var(--quiet);
    }

    .wet {
      stroke: var(--accent);
    }
  `,
})
export class WeatherIcon {
  readonly icon = input.required<Icon>();

  /** A cloud sitting high enough to leave room for what falls from it. */
  protected readonly raisedCloud = 'M7 15h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.6A2.8 2.8 0 0 0 7 15z';
}
