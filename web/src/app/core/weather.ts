import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Family } from './family';

export type WeatherIcon = 'Sun' | 'Moon' | 'PartlyCloudy' | 'Cloud' | 'Fog' | 'Rain' | 'Snow' | 'Storm';

/** One day of the forecast, by the family's day. */
export interface ForecastDay {
  date: string;
  description: string;
  icon: WeatherIcon;
  high: number;
  low: number;
}

/** Today's weather where the family lives, in its own units, and the coming week's forecast, today first. */
export interface Weather {
  temperature: number;
  description: string;
  icon: WeatherIcon;
  high: number;
  low: number;
  unit: 'F' | 'C';
  days?: ForecastDay[];
}

/**
 * Today's weather, for the wall's header and the phone's Today screen. There is none until a
 * parent sets where the family lives, and none while the forecast cannot be reached, so the
 * screens simply leave it out.
 */
@Injectable({ providedIn: 'root' })
export class WeatherStore {
  private readonly http = inject(HttpClient);
  private readonly current = signal<Weather | null>(null);
  private shown: string | null = null;

  readonly weather = this.current.asReadonly();

  /** The forecast for a day of the coming week, if there is one. */
  forecastFor(day: string): ForecastDay | undefined {
    return this.current()?.days?.find((d) => d.date === day);
  }

  /** Shows the weather for the family's place and units. Asking again for the same place does nothing. */
  show(family: Family): void {
    const place =
      family.latitude === null || family.longitude === null
        ? null
        : `${family.latitude},${family.longitude},${family.units},${family.timeZone}`;
    if (place === this.shown) {
      return;
    }
    this.shown = place;
    this.current.set(null);
    if (place !== null) {
      this.fetch(place);
    }
  }

  /** Fetches the weather again. A failed attempt keeps what is shown. */
  refresh(): void {
    if (this.shown !== null) {
      this.fetch(this.shown);
    }
  }

  private fetch(place: string): void {
    // No content means the family has no place, an error that the forecast is out of reach.
    this.http.get<Weather | null>('/api/weather').subscribe({
      next: (weather) => {
        if (this.shown === place) {
          this.current.set(weather);
        }
      },
      error: () => {},
    });
  }
}
