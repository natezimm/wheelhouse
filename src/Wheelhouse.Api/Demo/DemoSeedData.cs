using System;
using System.Collections.Generic;
using System.Linq;

namespace Wheelhouse.Api.Demo;

/// <summary>
/// Dynamic, self-healing demo seed generator for the fictional Marlowe family.
/// Every date is computed relative to the family-local date when the demo copy is created,
/// ensuring appointments and recurring events never go stale.
/// </summary>
public static class DemoSeedData
{
    public const string DefaultTimeZoneId = "America/New_York";

    /// <summary>How far back and ahead of the copy's first day the weekly series are expanded.</summary>
    public const int SeriesDaysBack = 42, SeriesDaysAhead = 91;

    /// <summary>
    /// Builds a complete, cohesive demo dataset anchored to <paramref name="utcNow"/> in the family's time zone.
    /// </summary>
    public static DemoCalendarSnapshot Build(DateTimeOffset utcNow, string timeZoneId = DefaultTimeZoneId)
    {
        var anchor = new DemoDateAnchor(utcNow, timeZoneId);
        var family = BuildFamily(anchor);
        var members = BuildMembers(family.Id);

        var clara = members.Single(m => m.Name == "Clara");
        var julian = members.Single(m => m.Name == "Julian");
        var milo = members.Single(m => m.Name == "Milo");
        var nora = members.Single(m => m.Name == "Nora");

        var calendars = BuildCalendarSources(family.Id, clara.Id, julian.Id, milo.Id, nora.Id);
        var events = BuildEvents(anchor, family.Id, calendars);
        return new DemoCalendarSnapshot(anchor.Today, family, members, calendars, events);
    }

    // -------------------------------------------------------------------------
    // 1. FAMILY & MEMBERS
    // -------------------------------------------------------------------------

    private static DemoFamilySeed BuildFamily(DemoDateAnchor anchor) => new(
        Id: Guid.NewGuid(),
        Name: "The Marlowe Family",
        TimeZoneId: anchor.TimeZone.Id,
        LocationName: "Maplewood, NJ",
        Latitude: 40.73m,
        Longitude: -74.27m,
        CreatedAtUtc: anchor.UtcNow,
        ExpiresAtUtc: anchor.UtcNow.AddHours(24),
        CalendarChangeNumber: 1);

    private static IReadOnlyList<DemoMemberSeed> BuildMembers(Guid familyId) =>
    [
        new(Guid.NewGuid(), familyId, "Clara",  Role: "Parent", ColorHex: "#2563eb", Avatar: "fox",     SortOrder: 1),
        new(Guid.NewGuid(), familyId, "Julian", Role: "Parent", ColorHex: "#0d9488", Avatar: "bear",    SortOrder: 2),
        new(Guid.NewGuid(), familyId, "Milo",   Role: "Child",  ColorHex: "#d97706", Avatar: "dino",    SortOrder: 3),
        new(Guid.NewGuid(), familyId, "Nora",   Role: "Child",  ColorHex: "#db2777", Avatar: "unicorn", SortOrder: 4)
    ];

    // -------------------------------------------------------------------------
    // 2. CALENDAR SOURCES & DYNAMIC EVENTS
    // -------------------------------------------------------------------------

    private static DemoCalendarSet BuildCalendarSources(
        Guid familyId,
        Guid claraId,
        Guid julianId,
        Guid miloId,
        Guid noraId) => new(
        Family:   new(Guid.NewGuid(), familyId, MemberId: null,     Name: "Marlowe Household",      CanWrite: true,  IsSelected: true),
        Clara:    new(Guid.NewGuid(), familyId, MemberId: claraId,  Name: "Clara",                  CanWrite: true,  IsSelected: true),
        Julian:   new(Guid.NewGuid(), familyId, MemberId: julianId, Name: "Julian",                 CanWrite: true,  IsSelected: true),
        Milo:     new(Guid.NewGuid(), familyId, MemberId: miloId,   Name: "Milo — School & Sports", CanWrite: true,  IsSelected: true),
        Nora:     new(Guid.NewGuid(), familyId, MemberId: noraId,   Name: "Nora — Activities",      CanWrite: true,  IsSelected: true),
        District: new(Guid.NewGuid(), familyId, MemberId: null,     Name: "Maplewood School District", CanWrite: false, IsSelected: true));

    private static IReadOnlyList<DemoEventSeed> BuildEvents(
        DemoDateAnchor anchor,
        Guid familyId,
        DemoCalendarSet calendars)
    {
        var events = new List<DemoEventSeed>();
        var today = anchor.Today;
        // Some events are for more than their calendar's owner, as a hidden tag on the Google event says.
        var (julian, nora) = (calendars.Julian.MemberId!.Value, calendars.Nora.MemberId!.Value);

        // --- TODAY (Always immediately visible on Phone Today & Wall Day/Week) ---
        events.Add(anchor.TimedEvent(
            familyId, calendars.Clara.Id,
            title: "Product architecture sync",
            date: today, start: new(9, 30), end: new(10, 15),
            location: "Home office / Meet",
            description: "Review Q4 milestone checklist with design lead."));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Julian.Id,
            title: "Coffee & grocery pickup run",
            date: today, start: new(12, 15), end: new(13, 0),
            location: "Village Market"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Milo.Id,
            title: "After-school robotics club",
            date: today, start: new(15, 30), end: new(17, 0),
            location: "Middle School Lab 204",
            description: "Julian picking up on the way back.",
            people: [julian]));

        // A busy afternoon: three people at once, so the week shows overlapping events side by side.
        events.Add(anchor.TimedEvent(
            familyId, calendars.Nora.Id,
            title: "Swim lessons",
            date: today, start: new(15, 0), end: new(16, 0),
            location: "Riverside Rec Center"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Clara.Id,
            title: "Pick up Nora from the pool",
            date: today, start: new(15, 45), end: new(16, 15),
            location: "Riverside Rec Center",
            people: [nora]));

        // A stay across several days, shown as one bar in the week's all-day lane.
        events.Add(anchor.AllDayEvent(
            familyId, calendars.Family.Id,
            title: "Grandma Evelyn visiting",
            startDate: today.AddDays(-1),
            endDateExclusive: today.AddDays(2)));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Family.Id,
            title: "Family Taco Night & porch hangout",
            date: today, start: new(18, 15), end: new(19, 30),
            location: "Home"));

        // --- TOMORROW ---
        var tomorrow = today.AddDays(1);
        events.Add(anchor.TimedEvent(
            familyId, calendars.Nora.Id,
            title: "Piano lesson with Ms. Alvarez",
            date: tomorrow, start: new(16, 0), end: new(16, 45),
            location: "Community Music Studio",
            description: "Bring level 2 sight-reading book."));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Julian.Id,
            title: "Client site walkthrough",
            date: tomorrow, start: new(10, 30), end: new(12, 0),
            location: "Summit Ave Renovation"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Julian.Id,
            title: "Morning run",
            date: tomorrow, start: new(7, 15), end: new(8, 0),
            location: "South Mountain Reservation"));

        // --- RELATIVE WEEKDAY ANCHORS (Always in the future, never stale) ---
        // Example requested: "A doctor's appointment is always next Tuesday"
        var nextTuesday = anchor.NextWeekday(DayOfWeek.Tuesday);
        events.Add(anchor.TimedEvent(
            familyId, calendars.Milo.Id,
            title: "Pediatric checkup — Dr. Patel",
            date: nextTuesday, start: new(10, 30), end: new(11, 30),
            location: "Maplewood Pediatrics, Suite 300",
            description: "Bring signed school sports physical form."));

        var nextWednesday = anchor.NextWeekday(DayOfWeek.Wednesday);
        events.Add(anchor.TimedEvent(
            familyId, calendars.Clara.Id,
            title: "Dental cleaning — Dr. Lin",
            date: nextWednesday, start: new(14, 0), end: new(15, 0),
            location: "Parkside Dental"));

        var nextThursday = anchor.NextWeekday(DayOfWeek.Thursday);
        events.Add(anchor.TimedEvent(
            familyId, calendars.Family.Id,
            title: "Vet booster visit for Barnaby",
            date: nextThursday, start: new(16, 30), end: new(17, 15),
            location: "Valley Veterinary Clinic",
            description: "Annual Bordetella & heartworm check."));

        var nextFriday = anchor.NextWeekday(DayOfWeek.Friday);
        // Private in Google, so a paired display shows only that Clara is busy.
        events.Add(anchor.TimedEvent(
            familyId, calendars.Clara.Id,
            title: "Anniversary dinner reservation",
            date: nextFriday, start: new(19, 30), end: new(21, 30),
            location: "Le Petit Jardin",
            description: "Babysitter booked 7–10 PM.",
            isPrivate: true));

        events.Add(anchor.AllDayEvent(
            familyId, calendars.District.Id,
            title: "School Spirit Day — Wear Blue & Gold",
            startDate: nextFriday,
            endDateExclusive: nextFriday.AddDays(1),
            description: "Read-only event from Maplewood School District feed."));

        // --- UPCOMING WEEKEND ---
        var comingSaturday = anchor.UpcomingWeekend(DayOfWeek.Saturday);
        var comingSunday = comingSaturday.AddDays(1);

        events.Add(anchor.TimedEvent(
            familyId, calendars.Family.Id,
            title: "Farmers market & bakery run",
            date: comingSaturday, start: new(9, 0), end: new(10, 30),
            location: "Springfield Ave Farmers Market",
            people: [julian, nora]));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Nora.Id,
            title: "U10 Rec Soccer vs. South Orange",
            date: comingSaturday, start: new(11, 0), end: new(12, 15),
            location: "Memorial Park Field 2",
            description: "Nora is on orange-slice snack duty."));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Family.Id,
            title: "Sunday roast dinner with Grandma Evelyn",
            date: comingSunday, start: new(17, 0), end: new(19, 30),
            location: "Home"));

        // --- NEXT WEEKEND MULTI-DAY ALL-DAY TRIP ---
        var nextWeekendSat = comingSaturday.AddDays(7);
        events.Add(anchor.AllDayEvent(
            familyId, calendars.Family.Id,
            title: "Catskills Cabin Weekend",
            startDate: nextWeekendSat,
            endDateExclusive: nextWeekendSat.AddDays(2), // Exclusive Monday end, matching Google Calendar
            location: "Phoenicia, NY",
            description: "Check-in after 3 PM Saturday; pack hiking boots and board games.",
            // The wall counts down the days to the trip.
            countdown: true));

        events.Add(anchor.AllDayEvent(
            familyId, calendars.Family.Id,
            title: "Nora's birthday",
            startDate: today.AddDays(33),
            endDateExclusive: today.AddDays(34),
            people: [nora],
            countdown: true));

        // --- EARLIER DAYS (so the current week and month look lived in, not only what is ahead) ---
        events.Add(anchor.TimedEvent(
            familyId, calendars.Milo.Id,
            title: "Science fair build session",
            date: today.AddDays(-1), start: new(16, 0), end: new(17, 30),
            location: "Garage workbench"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Clara.Id,
            title: "Book club at Priya's",
            date: today.AddDays(-2), start: new(19, 0), end: new(21, 0),
            location: "Ridgewood Rd"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Julian.Id,
            title: "Permit review at Town Hall",
            date: today.AddDays(-3), start: new(9, 0), end: new(10, 0),
            location: "Maplewood Town Hall"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Nora.Id,
            title: "Library reading buddies",
            date: today.AddDays(-3), start: new(15, 30), end: new(16, 30),
            location: "Maplewood Memorial Library"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Family.Id,
            title: "Family movie night",
            date: today.AddDays(-4), start: new(19, 0), end: new(21, 0),
            location: "Home"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Family.Id,
            title: "Apple picking at Hillside Orchard",
            date: today.AddDays(-9), start: new(10, 0), end: new(13, 0),
            location: "Hillside Orchard"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Clara.Id,
            title: "Haircut",
            date: today.AddDays(-16), start: new(12, 0), end: new(12, 45),
            location: "Studio Nine"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Milo.Id,
            title: "Robotics regional qualifier",
            date: today.AddDays(-23), start: new(8, 30), end: new(15, 0),
            location: "County STEM Center"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Julian.Id,
            title: "Car service",
            date: today.AddDays(-30), start: new(8, 0), end: new(9, 0),
            location: "Valley Auto"));

        // --- EXPANDED RECURRING SERIES (six weeks back to three months ahead, so a visitor stepping ahead keeps finding them) ---
        // 1. Nora's Tue/Thu Soccer Practice (Weekly series)
        var soccerSeriesId = Guid.NewGuid().ToString("N");
        for (var offset = -SeriesDaysBack; offset <= SeriesDaysAhead; offset++)
        {
            var d = today.AddDays(offset);
            if (d.DayOfWeek is DayOfWeek.Tuesday or DayOfWeek.Thursday)
            {
                events.Add(anchor.TimedEvent(
                    familyId, calendars.Nora.Id,
                    title: "Soccer practice",
                    date: d, start: new(17, 15), end: new(18, 30),
                    location: "Dehart Park Turf",
                    seriesId: soccerSeriesId,
                    repeatRule: "RRULE:FREQ=WEEKLY;BYDAY=TU,TH",
                    description: "Shin guards and a full water bottle. Coach Dana cancels by text if it storms."));
            }
        }

        // 2. Garbage & Recycling Night (Weekly on Wednesday evening)
        var trashSeriesId = Guid.NewGuid().ToString("N");
        for (var offset = -SeriesDaysBack; offset <= SeriesDaysAhead; offset++)
        {
            var d = today.AddDays(offset);
            if (d.DayOfWeek == DayOfWeek.Wednesday)
            {
                events.Add(anchor.TimedEvent(
                    familyId, calendars.Family.Id,
                    title: "Roll trash & recycling barrels to curb",
                    date: d, start: new(19, 30), end: new(20, 0),
                    seriesId: trashSeriesId,
                    repeatRule: "RRULE:FREQ=WEEKLY;BYDAY=WE"));
            }
        }

        // 3. The family's other weekly routines, so a week or month ahead looks as lived-in as this one.
        // None of them touches 1 to 2 PM, the hour the full-stack browser checks add their events at.
        void Weekly(Guid calendarId, string title, DayOfWeek[] days, TimeOnly start, TimeOnly end, string? location = null, string? description = null)
        {
            var seriesId = Guid.NewGuid().ToString("N");
            var byDay = string.Join(",", days.Select(d => d.ToString()[..2].ToUpperInvariant()));
            for (var offset = -SeriesDaysBack; offset <= SeriesDaysAhead; offset++)
            {
                var d = today.AddDays(offset);
                if (days.Contains(d.DayOfWeek))
                {
                    events.Add(anchor.TimedEvent(
                        familyId, calendarId, title: title, date: d, start: start, end: end,
                        location: location, description: description,
                        seriesId: seriesId, repeatRule: $"RRULE:FREQ=WEEKLY;BYDAY={byDay}"));
                }
            }
        }

        Weekly(calendars.Julian.Id, "Gym — strength session", [DayOfWeek.Monday, DayOfWeek.Wednesday, DayOfWeek.Friday],
            new(7, 0), new(7, 45), location: "Maplewood Fitness");
        Weekly(calendars.Clara.Id, "1:1 with Priya", [DayOfWeek.Thursday], new(11, 0), new(11, 30),
            location: "Meet", description: "Weekly check-in: hiring plan, roadmap risks, anything blocked.");
        Weekly(calendars.Milo.Id, "Math circle", [DayOfWeek.Wednesday], new(15, 30), new(16, 30),
            location: "Maplewood Middle School Library");
        Weekly(calendars.Nora.Id, "Dance class", [DayOfWeek.Friday], new(16, 0), new(17, 0),
            location: "Maplewood Dance Studio", description: "Hair in a bun; pink tights are in the blue bag.");
        Weekly(calendars.Julian.Id, "Guitar lesson", [DayOfWeek.Tuesday], new(19, 0), new(19, 45), location: "Maple Music Co.");
        Weekly(calendars.Clara.Id, "Yoga flow", [DayOfWeek.Saturday], new(7, 30), new(8, 30), location: "Studio Breathe");
        Weekly(calendars.Milo.Id, "Swim team", [DayOfWeek.Monday], new(17, 30), new(18, 30), location: "Riverside Rec Center");
        Weekly(calendars.Family.Id, "Sunday pancake breakfast", [DayOfWeek.Sunday], new(9, 0), new(10, 0), location: "Home");

        // --- LATER THIS SEASON (one-off plans in the weeks after next) ---
        events.Add(anchor.TimedEvent(
            familyId, calendars.Milo.Id,
            title: "Parent–teacher conference",
            date: anchor.NextWeekday(DayOfWeek.Thursday, 1), start: new(18, 45), end: new(19, 15),
            location: "Maplewood Middle School, Room 114",
            people: [calendars.Clara.MemberId!.Value]));

        events.Add(anchor.AllDayEvent(
            familyId, calendars.District.Id,
            title: "Early dismissal — 12:30 pm",
            startDate: anchor.NextWeekday(DayOfWeek.Friday, 1), endDateExclusive: anchor.NextWeekday(DayOfWeek.Friday, 1).AddDays(1)));

        events.Add(anchor.AllDayEvent(
            familyId, calendars.Julian.Id,
            title: "Work trip — Chicago",
            startDate: anchor.NextWeekday(DayOfWeek.Monday, 2), endDateExclusive: anchor.NextWeekday(DayOfWeek.Monday, 2).AddDays(2),
            description: "Back on the late flight; Clara has school pickup both days."));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Family.Id,
            title: "Milo's winter band concert",
            date: anchor.NextWeekday(DayOfWeek.Thursday, 2), start: new(19, 0), end: new(20, 30),
            location: "Maplewood Middle School Auditorium"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Nora.Id,
            title: "Eye exam — Dr. Okafor",
            date: anchor.NextWeekday(DayOfWeek.Tuesday, 3), start: new(15, 30), end: new(16, 15),
            location: "Clearview Optometry"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Family.Id,
            title: "Holiday lights drive",
            date: anchor.NextWeekday(DayOfWeek.Saturday, 3), start: new(18, 0), end: new(19, 30),
            description: "Hot cocoa in the thermos. Start on Ridgewood Rd."));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Clara.Id,
            title: "Quarterly planning offsite",
            date: anchor.NextWeekday(DayOfWeek.Wednesday, 4), start: new(9, 0), end: new(12, 0),
            location: "Montclair Commons, Room B"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Family.Id,
            title: "Ice skating at the town rink",
            date: anchor.NextWeekday(DayOfWeek.Sunday, 5), start: new(10, 30), end: new(12, 0),
            location: "Maplewood Memorial Park Rink"));

        return events;
    }

}

// =============================================================================
// DYNAMIC DATE ANCHOR HELPER
// =============================================================================

/// <summary>
/// Resolves all demo dates and instants relative to the family's local time zone at seed time,
/// handling DST transitions (spring-forward gaps and fall-back overlaps) deterministically.
/// </summary>
public sealed class DemoDateAnchor
{
    public DateTimeOffset UtcNow { get; }
    public TimeZoneInfo TimeZone { get; }
    public DateOnly Today { get; }

    public DemoDateAnchor(DateTimeOffset utcNow, string timeZoneId)
    {
        UtcNow = utcNow;
        TimeZone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        var localNow = TimeZoneInfo.ConvertTime(utcNow, TimeZone);
        Today = DateOnly.FromDateTime(localNow.DateTime);
    }

    /// <summary>
    /// Returns the next occurrence of <paramref name="targetDay"/> strictly after <see cref="Today"/>
    /// (1 to 7 days in the future), plus optional extra weeks.
    /// For example, "a doctor's appointment is always next Tuesday" is never in the past.
    /// </summary>
    public DateOnly NextWeekday(DayOfWeek targetDay, int extraWeeks = 0)
    {
        var daysAhead = ((int)targetDay - (int)Today.DayOfWeek + 7) % 7;
        if (daysAhead == 0)
        {
            daysAhead = 7; // Strictly in the future so an appointment is never earlier today/past
        }

        return Today.AddDays(daysAhead + (extraWeeks * 7));
    }

    /// <summary>
    /// Returns the upcoming Saturday or Sunday (including today if today is already that weekend day).
    /// </summary>
    public DateOnly UpcomingWeekend(DayOfWeek weekendDay)
    {
        var daysAhead = ((int)weekendDay - (int)Today.DayOfWeek + 7) % 7;
        return Today.AddDays(daysAhead);
    }

    /// <summary>
    /// Returns the Monday of the week containing <paramref name="date"/> (matching Wheelhouse's Monday week anchor).
    /// </summary>
    public DateOnly StartOfWeek(DateOnly date)
    {
        var diff = ((int)date.DayOfWeek - (int)DayOfWeek.Monday + 7) % 7;
        return date.AddDays(-diff);
    }

    /// <summary>
    /// Converts a family-local <see cref="DateOnly"/> and wall-clock time to a UTC <see cref="DateTimeOffset"/>,
    /// shifting forward across spring-forward DST gaps and choosing the standard offset on fall-back overlaps.
    /// </summary>
    public DateTimeOffset AtLocalTime(DateOnly date, int hour, int minute)
    {
        var unspecified = date.ToDateTime(new TimeOnly(hour, minute), DateTimeKind.Unspecified);
        if (TimeZone.IsInvalidTime(unspecified))
        {
            unspecified = unspecified.AddHours(1);
        }

        var offset = TimeZone.IsAmbiguousTime(unspecified)
            ? TimeZone.GetAmbiguousTimeOffsets(unspecified).Min()
            : TimeZone.GetUtcOffset(unspecified);
        return new DateTimeOffset(unspecified, offset).ToUniversalTime();
    }

    public DemoEventSeed TimedEvent(
        Guid familyId,
        Guid calendarSourceId,
        string title,
        DateOnly date,
        TimeOnly start,
        TimeOnly end,
        string? location = null,
        string? description = null,
        string? seriesId = null,
        string? repeatRule = null,
        IReadOnlyList<Guid>? people = null,
        bool isPrivate = false,
        bool countdown = false) => new(
        Id: Guid.NewGuid(),
        FamilyId: familyId,
        CalendarSourceId: calendarSourceId,
        Title: title,
        IsAllDay: false,
        StartUtc: AtLocalTime(date, start.Hour, start.Minute),
        EndUtc: AtLocalTime(date, end.Hour, end.Minute),
        StartDate: null,
        EndDateExclusive: null,
        Location: location,
        Description: description,
        SeriesId: seriesId,
        RepeatFrequency: repeatRule,
        ETag: $"\"demo-{Guid.NewGuid():N}\"",
        MemberIds: people ?? [],
        IsPrivate: isPrivate,
        Countdown: countdown);

    public DemoEventSeed AllDayEvent(
        Guid familyId,
        Guid calendarSourceId,
        string title,
        DateOnly startDate,
        DateOnly endDateExclusive,
        string? location = null,
        string? description = null,
        IReadOnlyList<Guid>? people = null,
        bool countdown = false) => new(
        Id: Guid.NewGuid(),
        FamilyId: familyId,
        CalendarSourceId: calendarSourceId,
        Title: title,
        IsAllDay: true,
        StartUtc: null,
        EndUtc: null,
        StartDate: startDate,
        EndDateExclusive: endDateExclusive,
        Location: location,
        Description: description,
        SeriesId: null,
        RepeatFrequency: null,
        ETag: $"\"demo-{Guid.NewGuid():N}\"",
        MemberIds: people ?? [],
        IsPrivate: false,
        Countdown: countdown);
}

// =============================================================================
// SEED DATA RECORDS
// =============================================================================

public sealed record DemoCalendarSnapshot(
    DateOnly AnchorDate,
    DemoFamilySeed Family,
    IReadOnlyList<DemoMemberSeed> Members,
    DemoCalendarSet Calendars,
    IReadOnlyList<DemoEventSeed> Events);

public sealed record DemoFamilySeed(
    Guid Id,
    string Name,
    string TimeZoneId,
    string LocationName,
    decimal Latitude,
    decimal Longitude,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ExpiresAtUtc,
    long CalendarChangeNumber);

public sealed record DemoMemberSeed(
    Guid Id,
    Guid FamilyId,
    string Name,
    string Role,
    string ColorHex,
    string? Avatar,
    int SortOrder);

public sealed record DemoCalendarSourceSeed(
    Guid Id,
    Guid FamilyId,
    Guid? MemberId,
    string Name,
    bool CanWrite,
    bool IsSelected);

public sealed record DemoCalendarSet(
    DemoCalendarSourceSeed Family,
    DemoCalendarSourceSeed Clara,
    DemoCalendarSourceSeed Julian,
    DemoCalendarSourceSeed Milo,
    DemoCalendarSourceSeed Nora,
    DemoCalendarSourceSeed District)
{
    public IReadOnlyList<DemoCalendarSourceSeed> All => [Family, Clara, Julian, Milo, Nora, District];
}

public sealed record DemoEventSeed(
    Guid Id,
    Guid FamilyId,
    Guid CalendarSourceId,
    string Title,
    bool IsAllDay,
    DateTimeOffset? StartUtc,
    DateTimeOffset? EndUtc,
    DateOnly? StartDate,
    DateOnly? EndDateExclusive,
    string? Location,
    string? Description,
    string? SeriesId,
    string? RepeatFrequency,
    string ETag,
    IReadOnlyList<Guid> MemberIds,
    bool IsPrivate,
    bool Countdown = false);
