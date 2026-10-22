import { Routes } from '@angular/router';

// One app, two layouts: the wall display opens /wall in kiosk mode; phones and desktop browsers open /.
// Settings exist only on the phone; the wall has none.
export const routes: Routes = [
  // The calendar for phones and desktop browsers; /calendar is kept for old links and bookmarks.
  { path: '', pathMatch: 'full', loadComponent: () => import('./home/calendar-home').then((m) => m.CalendarHome) },
  { path: 'calendar', redirectTo: '' },
  { path: 'settings', loadComponent: () => import('./phone/settings').then((m) => m.Settings) },
  {
    path: 'settings/members/new',
    loadComponent: () => import('./phone/member-editor').then((m) => m.MemberEditor),
  },
  {
    path: 'settings/members/:id',
    loadComponent: () => import('./phone/member-editor').then((m) => m.MemberEditor),
  },
  {
    path: 'settings/calendars',
    loadComponent: () => import('./phone/calendar-picker').then((m) => m.CalendarPicker),
  },
  {
    path: 'settings/displays/pair',
    loadComponent: () => import('./phone/pair-display').then((m) => m.PairDisplay),
  },
  { path: 'privacy', loadComponent: () => import('./phone/privacy').then((m) => m.Privacy) },
  { path: 'wall', loadComponent: () => import('./wall/wall-shell').then((m) => m.WallShell) },
  { path: '**', redirectTo: '' },
];

