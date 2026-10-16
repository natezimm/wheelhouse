using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Demo;

/// <summary>The fictional family every demo visitor starts from.</summary>
public static class DemoFamily
{
    /// <summary>
    /// Builds one visitor's copy. Each copy gets its own ids, so copies never collide, and seed
    /// data added later (events, chores, meals) should point at these member objects.
    /// </summary>
    public static Family Create(Guid familyId, DateTimeOffset expiresAt)
    {
        var family = new Family
        {
            Id = familyId,
            Name = "The Marlowes",
            TimeZone = "America/New_York",
            Latitude = 40.7128,
            Longitude = -74.0060,
            ExpiresAt = expiresAt,
        };

        family.Members.AddRange(
        [
            Member(family, 1, "Ben", "#2F5FC4", MemberRole.Parent),
            Member(family, 2, "Tess", "#B85A14", MemberRole.Parent),
            Member(family, 3, "Milo", "#137A6D", MemberRole.Kid),
        ]);

        // A display that looks as if it was paired when the copy was made, so a visitor's phone
        // has one to show in Settings. Pairing a real browser at /wall adds another.
        var created = expiresAt - DemoCopies.Lifetime;
        family.Devices.Add(new Device
        {
            Id = Guid.CreateVersion7(),
            FamilyId = family.Id,
            Name = "Kitchen wall",
            PairedAt = created,
            LastSeenAt = created,
        });

        DemoCalendar.AddTo(family, created);

        return family;
    }

    private static Member Member(Family family, int sortOrder, string name, string color, MemberRole role) => new()
    {
        Id = Guid.CreateVersion7(),
        FamilyId = family.Id,
        DisplayName = name,
        Color = color,
        Initial = name[..1],
        Role = role,
        SortOrder = sortOrder,
    };
}
