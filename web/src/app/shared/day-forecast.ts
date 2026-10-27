import { Component, computed, effect, inject, input } from '@angular/core';
import { FamilyStore } from '../core/family';
import { WeatherStore } from '../core/weather';
import { WeatherIcon } from './weather-icon';

/** A day's forecast in a day's heading: an icon with the high and low. Nothing outside the coming week. */
@Component({
  selector: 'app-day-forecast',
  imports: [WeatherIcon],
  template: `
    @if (forecast(); as day) {
      <app-weather-icon [icon]="day.icon" />
      <span class="temps" [attr.aria-label]="day.description + ', high ' + day.high + '°, low ' + day.low + '°'">
        {{ day.high }}°<span class="low">{{ day.low }}°</span>
      </span>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 14px;
      font-weight: 700;
      color: var(--ink);
      white-space: nowrap;
    }

    app-weather-icon {
      width: var(--forecast-icon, 22px);
      height: var(--forecast-icon, 22px);
    }

    .low {
      margin-left: 4px;
      font-weight: 600;
      color: var(--faint);
    }
  `,
})
export class DayForecast {
  readonly day = input.required<string>();

  private readonly weather = inject(WeatherStore);
  protected readonly forecast = computed(() => this.weather.forecastFor(this.day()));

  constructor() {
    const family = inject(FamilyStore);
    // The store asks once per place, so every heading can make sure the forecast is there.
    effect(() => {
      const state = family.state();
      if (state.status === 'ready') {
        this.weather.show(state.family);
      }
    });
  }
}
