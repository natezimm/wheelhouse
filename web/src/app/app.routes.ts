import { Routes } from '@angular/router';

// One app, two layouts: the wall display opens /wall in kiosk mode, phones open /.
export const routes: Routes = [
  { path: '', loadComponent: () => import('./phone/phone-shell').then((m) => m.PhoneShell) },
  { path: 'wall', loadComponent: () => import('./wall/wall-shell').then((m) => m.WallShell) },
  { path: '**', redirectTo: '' },
];
