using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Demo;

/// <summary>Maps the fictional dataset into one visitor's independent EF aggregate.</summary>
internal static class DemoSeedAdapter
{
    public static Family Create(Guid familyId, DateTimeOffset expiresAt)
    {
        var created = expiresAt - DemoCopies.Lifetime;
        var seed = DemoSeedData.Build(created);
        // The caller owns identity and expiry. EF owns concurrency tokens and domain revisions;
        // seed-record versions are descriptive, not persisted concurrency values.
        var family = new Family
        {
            Id = familyId, Name = seed.Family.Name, TimeZone = seed.Family.TimeZoneId,
            Latitude = (double)seed.Family.Latitude, Longitude = (double)seed.Family.Longitude,
            ExpiresAt = expiresAt,
        };
        family.Members.AddRange(seed.Members.Select(m => new Member
        {
            Id = m.Id, FamilyId = family.Id, DisplayName = m.Name, Initial = m.Name[..1],
            Color = m.ColorHex, Role = m.Role == "Parent" ? MemberRole.Parent : MemberRole.Kid,
            SortOrder = m.SortOrder,
        }));
        family.Devices.Add(new Device
        {
            Id = Guid.CreateVersion7(), FamilyId = family.Id, Name = "Kitchen wall",
            PairedAt = created, LastSeenAt = created,
        });

        foreach (var source in seed.Calendars.All)
        {
            var calendar = new CalendarSource
            {
                Id = source.Id, FamilyId = family.Id, GoogleCalendarId = $"demo-{source.Id:N}",
                Name = source.Name, MemberId = source.MemberId, CanWrite = source.CanWrite,
            };
            calendar.Events.AddRange(seed.Events.Where(e => e.CalendarSourceId == source.Id).Select(e => new EventInstance
            {
                Id = e.Id, FamilyId = family.Id, CalendarSourceId = source.Id,
                GoogleEventId = $"demo-{e.Id:N}", RecurringEventId = e.SeriesId, ETag = e.ETag,
                Title = e.Title, Location = e.Location, StartsAt = e.StartUtc, EndsAt = e.EndUtc,
                StartDate = e.StartDate, EndDate = e.EndDateExclusive,
            }));
            family.Calendars.Add(calendar);
        }

        return family;

    }
}
