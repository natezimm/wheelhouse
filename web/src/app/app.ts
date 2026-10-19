import { CalendarLive } from './core/calendar-live';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  template: '<router-outlet />',
})
export class App {
  private readonly calendarLive = inject(CalendarLive);
}
