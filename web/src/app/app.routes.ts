import { Routes } from '@angular/router';

// One app, two layouts: the wall display opens /wall in kiosk mode, phones open /.
// Settings exist only on the phone; the wall has none.
export const routes: Routes = [
  { path: '', loadComponent: () => import('./phone/phone-shell').then((m) => m.PhoneShell) },
  { path: 'settings', loadComponent: () => import('./phone/settings').then((m) => m.Settings) },
  {
    path: 'settings/members/new',
    loadComponent: () => import('./phone/member-editor').then((m) => m.MemberEditor),
  },
  {
    path: 'settings/members/:id',
    loadComponent: () => import('./phone/member-editor').then((m) => m.MemberEditor),
  },
  { path: 'wall', loadComponent: () => import('./wall/wall-shell').then((m) => m.WallShell) },
  { path: '**', redirectTo: '' },
];
