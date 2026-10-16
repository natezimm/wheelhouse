using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Demo;

/// <summary>
/// The demo family's calendars, as if their Google Calendar had just been synced: one calendar
/// per person and one for the whole family. Every date is relative to the day the copy is made,
/// so a visitor always lands on a busy, believable week. The demo never calls Google.
/// </summary>
public static class DemoCalendar
{
    /// <summary>How far back and ahead the seeded events reach, like the real sync's window.</summary>
    public const int DaysBack = 30;

    public const int DaysAhead = 120;

    public static void AddTo(Family family, DateTimeOffset createdAt)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(family.TimeZone);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(createdAt, zone).DateTime);
        var ben = family.Members.Single(m => m.DisplayName == "Ben");
        var tess = family.Members.Single(m => m.DisplayName == "Tess");
        var milo = family.Members.Single(m => m.DisplayName == "Milo");

        var seed = new Seed(family, zone, today, createdAt);
        var bens = seed.Calendar("Ben", ben);
        var tesss = seed.Calendar("Tess", tess);
        var milos = seed.Calendar("Milo", milo);
        var everyone = seed.Calendar("Family", member: null);

        // The weekly rhythm, which Google would expand into one occurrence a week.
        seed.Weekly(milos, "swim", DayOfWeek.Monday, "Swim lesson", new(16, 0), 45, "Riverside Rec Center");
        seed.Weekly(milos, "soccer", DayOfWeek.Wednesday, "Soccer practice", new(17, 30), 75, "Lincoln Park field 2");
        seed.Weekly(milos, "soccer-game", DayOfWeek.Saturday, "Soccer game", new(9, 0), 60, "Lincoln Park field 1");
        seed.Weekly(milos, "piano", DayOfWeek.Thursday, "Piano with Ms. Ortiz", new(16, 15), 30, null);
        seed.Weekly(tesss, "yoga", DayOfWeek.Tuesday, "Yoga", new(18, 30), 60, "Northside Studio");
        seed.Weekly(tesss, "book-club", DayOfWeek.Thursday, "Book club", new(19, 30), 120, null, everyOtherWeek: true);
        seed.Weekly(bens, "run-club", DayOfWeek.Wednesday, "Run club", new(6, 15), 60, "Harbor trail");
        seed.Weekly(bens, "climbing", DayOfWeek.Monday, "Climbing with Sam", new(19, 0), 90, "Granite Gym");
        seed.WeeklyAllDay(everyone, "trash", DayOfWeek.Tuesday, "Trash & recycling");
        seed.Weekly(everyone, "movie-night", DayOfWeek.Friday, "Pizza & movie night", new(18, 30), 150, null);
        seed.Weekly(everyone, "market", DayOfWeek.Sunday, "Farmers market", new(10, 0), 90, "Union Square");

        // One-off events around today, so the week on screen is full.
        seed.AllDay(everyone, -2, 4, "Grandma in town");
        seed.Timed(milos, 0, "Pediatrician checkup", new(10, 30), 45, "Bayview Pediatrics");
        seed.Timed(tesss, 0, "Lunch with Priya", new(12, 0), 60, "Corner Bistro");
        seed.Timed(bens, 0, "Dentist", new(15, 0), 60, "Dr. Hale, 4th floor");
        seed.Timed(bens, 1, "Haircut", new(18, 0), 30, null);
        seed.Timed(bens, 2, "Car to the shop", new(8, 0), 30, "Main St Auto");
        seed.Timed(tesss, 2, "Team offsite", new(9, 0), 480, "Pier 17");
        seed.Timed(bens, 3, "Flight to Chicago", new(6, 10), 150, "LGA Terminal B");
        seed.AllDay(bens, 3, 2, "Chicago work trip");
        seed.Timed(bens, 4, "Flight home", new(17, 40), 140, "ORD Terminal 3");
        seed.Timed(everyone, 5, "Friends over for dinner", new(18, 0), 180, null);
        seed.Timed(everyone, 6, "Lunch at Grandma's", new(12, 30), 120, null);
        seed.Timed(tesss, -5, "Parent-teacher conference", new(15, 30), 30, "Room 12");
        seed.Timed(milos, -3, "Library visit", new(11, 0), 60, null);
        seed.AllDay(milos, 8, 1, "School picture day");
        seed.Timed(tesss, 10, "Dentist", new(9, 0), 60, "Dr. Hale, 4th floor");
        seed.Timed(milos, 13, "Birthday party at Jonah's", new(14, 0), 120, "Bounce World");
        seed.AllDay(milos, 18, 1, "Field trip to the aquarium");
        seed.AllDay(everyone, 24, 3, "Weekend at the lake");
        seed.Timed(bens, 31, "Annual physical", new(8, 30), 60, null);
        seed.AllDay(everyone, 45, 1, "No school");
    }

    private sealed class Seed(Family family, TimeZoneInfo zone, DateOnly today, DateTimeOffset syncedAt)
    {
        private readonly DateOnly _first = today.AddDays(-DaysBack);
        private readonly DateOnly _last = today.AddDays(DaysAhead);

        public CalendarSource Calendar(string name, Member? member)
        {
            var source = new CalendarSource
            {
                Id = Guid.CreateVersion7(),
                FamilyId = family.Id,
                GoogleCalendarId = $"demo-{name.ToLowerInvariant()}",
                Name = name,
                MemberId = member?.Id,
                LastSyncedAt = syncedAt,
            };
            family.Calendars.Add(source);
            return source;
        }

        public void Weekly(
            CalendarSource source, string series, DayOfWeek day, string title, TimeOnly start, int minutes, string? location,
            bool everyOtherWeek = false)
        {
            var week = 0;
            for (var date = FirstOn(day); date <= _last; date = date.AddDays(7), week++)
            {
                if (everyOtherWeek && week % 2 == 1)
                {
                    continue;
                }

                var startsAt = CalendarEndpoints.At(date, start, zone);
                source.Events.Add(Event(source, $"{series}_{date:yyyyMMdd}", series, title, location, e =>
                {
                    e.StartsAt = startsAt;
                    e.EndsAt = startsAt.AddMinutes(minutes);
                }));
            }
        }

        public void WeeklyAllDay(CalendarSource source, string series, DayOfWeek day, string title)
        {
            for (var date = FirstOn(day); date <= _last; date = date.AddDays(7))
            {
                source.Events.Add(Event(source, $"{series}_{date:yyyyMMdd}", series, title, null, e =>
                {
                    e.StartDate = date;
                    e.EndDate = date.AddDays(1);
                }));
            }
        }

        public void Timed(CalendarSource source, int dayOffset, string title, TimeOnly start, int minutes, string? location)
        {
            var startsAt = CalendarEndpoints.At(today.AddDays(dayOffset), start, zone);
            source.Events.Add(Event(source, Guid.NewGuid().ToString("N"), null, title, location, e =>
            {
                e.StartsAt = startsAt;
                e.EndsAt = startsAt.AddMinutes(minutes);
            }));
        }

        public void AllDay(CalendarSource source, int dayOffset, int days, string title)
        {
            var start = today.AddDays(dayOffset);
            source.Events.Add(Event(source, Guid.NewGuid().ToString("N"), null, title, null, e =>
            {
                e.StartDate = start;
                e.EndDate = start.AddDays(days);
            }));
        }

        private DateOnly FirstOn(DayOfWeek day)
        {
            var date = _first;
            while (date.DayOfWeek != day)
            {
                date = date.AddDays(1);
            }

            return date;
        }

        private EventInstance Event(
            CalendarSource source, string eventId, string? series, string title, string? location, Action<EventInstance> when)
        {
            var instance = new EventInstance
            {
                Id = Guid.CreateVersion7(),
                FamilyId = family.Id,
                CalendarSourceId = source.Id,
                GoogleEventId = eventId,
                RecurringEventId = series,
                Title = title,
                Location = location,
            };
            when(instance);
            return instance;
        }
    }
}
