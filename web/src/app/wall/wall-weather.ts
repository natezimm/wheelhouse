import { Component, effect, inject } from '@angular/core';
import { FamilyStore } from '../core/family';
import { WeatherStore } from '../core/weather';
import { WeatherIcon } from '../shared/weather-icon';

/** Today's weather at the right of the wall's header. Nothing shows until there is some. */
@Component({
  selector: 'app-wall-weather',
  imports: [WeatherIcon],
  template: `
    @if (weather.weather(); as today) {
      <app-weather-icon [icon]="today.icon" />
      <div class="reading">
        <span class="temperature">{{ today.temperature }}°</span>
        <span class="summary">{{ today.description }} · H {{ today.high }}° L {{ today.low }}°</span>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    app-weather-icon {
      width: 48px;
      height: 48px;
    }

    .reading {
      display: flex;
      flex-direction: column;
    }

    .temperature {
      font-family: var(--font-display);
      font-size: 34px;
      font-weight: 600;
      line-height: 1;
    }

    .summary {
      font-size: 16px;
      color: var(--muted);
      white-space: nowrap;
    }
  `,
})
export class WallWeather {
  protected readonly weather = inject(WeatherStore);

  constructor() {
    const family = inject(FamilyStore);
    // A new place or units from a phone reaches the wall with the family's check-in.
    effect(() => {
      const state = family.state();
      if (state.status === 'ready') {
        this.weather.show(state.family);
      }
    });
  }
}
