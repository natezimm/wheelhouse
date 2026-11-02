import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Splash } from './core/splash';
import { ThemeService } from './core/theme';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  template: '<router-outlet />',
})
export class App {
  constructor() {
    // Every screen wears the family's theme, dark at night if the family chose so.
    inject(ThemeService);
    // index.html's splash fades once the first screen has something to show.
    inject(Splash).follow();
  }
}
