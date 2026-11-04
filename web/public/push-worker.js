// Shows the reminders the API pushes (src/Wheelhouse.Api/Reminders) and opens the event when one is
// tapped. It does nothing else: no caching, so the app loads as it always has. Registered from
// Settings (src/app/core/reminders.ts) when a phone turns reminders on.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch (e) {
    message = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'Wheelhouse', {
      body: message.body || '',
      tag: message.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: message.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  // Only this site's own pages.
  const target = url.origin === self.location.origin ? url.href : self.location.origin + '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).pathname !== '/wall' && 'focus' in client);
      if (open) {
        return open.focus().then((client) => (client && 'navigate' in client ? client.navigate(target) : undefined)).catch(() => self.clients.openWindow(target));
      }
      return self.clients.openWindow(target);
    }),
  );
});
