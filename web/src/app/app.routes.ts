import { Routes } from '@angular/router';

// One app, two layouts: the wall display opens /wall in kiosk mode, phones open /.
// Settings exist only on the phone; the wall has none.
export const routes: Routes = [
  { path: '', loadComponent: () => import('./phone/phone-shell').then((m) => m.PhoneShell) },
  { path: 'calendar', loadComponent: () => import('./phone/calendar').then((m) => m.PhoneCalendar) },
  { path: 'chores', loadComponent: () => import('./shared/chores-page').then((m) => m.ChoresPage) },
  { path: 'lists', loadComponent: () => import('./shared/lists-page').then((m) => m.ListsPage) },
  { path: 'meals', loadComponent: () => import('./shared/meals-page').then((m) => m.MealsPage) },
  { path: 'wall/meals', data: { wall: true }, loadComponent: () => import('./shared/meals-page').then((m) => m.MealsPage) },
  { path: 'wall/lists', data: { wall: true }, loadComponent: () => import('./shared/lists-page').then((m) => m.ListsPage) },
  { path: 'wall/chores', data: { wall: true }, loadComponent: () => import('./shared/chores-page').then((m) => m.ChoresPage) },
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

