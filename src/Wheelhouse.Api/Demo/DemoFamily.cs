using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Demo;

/// <summary>
/// The fictional family the public demo shows. Ids are fixed so that a reset puts back the
/// same rows, and later seed data (events, chores, meals) can point at these members.
/// </summary>
public static class DemoFamily
{
    public static readonly Guid Id = new("d0e00000-0000-4000-8000-000000000001");

    public const string TimeZone = "America/New_York";

    /// <summary>Local time of the nightly reset, when visitors' changes are thrown away.</summary>
    public static readonly TimeOnly ResetsAt = new(3, 30);

    public static Family Create()
    {
        var family = new Family
        {
            Id = Id,
            Name = "The Marlowes",
            TimeZone = TimeZone,
            Latitude = 40.7128,
            Longitude = -74.0060,
        };

        family.Members.AddRange(
        [
            Member(2, "Ben", "#2F5FC4", MemberRole.Parent),
            Member(3, "Tess", "#B85A14", MemberRole.Parent),
            Member(4, "Milo", "#137A6D", MemberRole.Kid),
        ]);

        return family;
    }

    private static Member Member(int number, string name, string color, MemberRole role) => new()
    {
        Id = new Guid($"d0e00000-0000-4000-8000-{number:D12}"),
        FamilyId = Id,
        DisplayName = name,
        Color = color,
        Initial = name[..1],
        Role = role,
        SortOrder = number,
    };
}
