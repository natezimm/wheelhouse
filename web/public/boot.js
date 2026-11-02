// Runs before the page is first drawn, so the splash wears the family's look from the start rather
// than flashing Daylight at a dark kitchen. ThemeService (src/app/core/theme.ts) saves the look on
// every start and takes over once the app is running; this only repeats its first step, from what
// it saved last time. It is a file rather than inline because the Content-Security-Policy allows
// scripts only from the site. Anything missing or unreadable leaves the page in Daylight.
(function () {
  var root = document.documentElement;
  var look;
  try {
    look = JSON.parse(localStorage.getItem('wheelhouse.look') || 'null');
  } catch (e) {
    return;
  }
  if (!look || typeof look.theme !== 'string' || !/^[a-z]+$/.test(look.theme)) return;

  function minutesOf(time) {
    var parts = String(time).split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  // The same rule as isNight in theme.ts, on the family's own clock.
  var night = look.nightMode === 'Always';
  if (look.nightMode === 'AtNight') {
    try {
      var now = minutesOf(
        new Intl.DateTimeFormat('en-GB', { timeZone: look.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()),
      );
      var from = minutesOf(look.nightFrom);
      var to = minutesOf(look.nightTo);
      night = from < to ? now >= from && now < to : now >= from || now < to;
    } catch (e) {
      night = false;
    }
  }

  root.setAttribute('data-theme', look.theme);
  if (night) root.setAttribute('data-night', '');

  var ground = look.grounds && look.grounds[night ? 1 : 0];
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta && /^#[0-9a-f]{6}$/i.test(ground)) meta.setAttribute('content', ground);

  // The theme's own fonts, for the splash's name; ThemeService sees this link and does not ask again.
  if (typeof look.fonts === 'string' && /^[A-Za-z0-9+:;,.@&=_-]+$/.test(look.fonts)) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?' + look.fonts + '&display=swap';
    link.setAttribute('data-fonts', look.theme);
    document.head.appendChild(link);
  }
})();
