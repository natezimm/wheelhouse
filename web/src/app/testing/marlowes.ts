import { Family } from '../core/family';

/** The demo family, as the API returns it. Shared by the specs. */
export const marlowes: Family = {
  id: 'f1',
  name: 'The Marlowes',
  timeZone: 'America/New_York',
  weekStartsOn: 'Monday',
  nightModeFrom: '21:30:00',
  nightModeTo: '06:30:00',
  theme: 'Daylight',
  autoNight: true,
  units: 'Imperial',
  // No place by default, so specs that are not about the weather never ask for it.
  latitude: null,
  longitude: null,
  members: [
    { id: 'm1', displayName: 'Ben', color: '#2F5FC4', initial: 'B', role: 'Parent' },
    { id: 'm2', displayName: 'Tess', color: '#B85A14', initial: 'T', role: 'Parent' },
    { id: 'm3', displayName: 'Milo', color: '#137A6D', initial: 'M', role: 'Kid' },
  ],
};
