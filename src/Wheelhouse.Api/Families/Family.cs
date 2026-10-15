using Wheelhouse.Api.Devices;

namespace Wheelhouse.Api.Families;

public sealed class Family
{
    public Guid Id { get; set; }

    public required string Name { get; set; }

    /// <summary>IANA zone id such as <c>America/New_York</c>. Every screen renders times in this zone.</summary>
    public required string TimeZone { get; set; }

    public DayOfWeek WeekStartsOn { get; set; } = DayOfWeek.Monday;

    /// <summary>The wall display dims to a clock between these two local times.</summary>
    public TimeOnly NightModeFrom { get; set; } = new(21, 30);

    public TimeOnly NightModeTo { get; set; } = new(6, 30);

    /// <summary>Where the weather is for. Null until a parent sets it.</summary>
    public double? Latitude { get; set; }

    public double? Longitude { get; set; }

    public Units Units { get; set; } = Units.Imperial;

    /// <summary>
    /// Set only on a demo visitor's private copy: when it may be deleted. A real family has
    /// none, so the demo's cleanup can never remove one.
    /// </summary>
    public DateTimeOffset? ExpiresAt { get; set; }

    public List<Member> Members { get; } = [];

    /// <summary>The wall displays paired with the family.</summary>
    public List<Device> Devices { get; } = [];
}

public enum Units
{
    Imperial,
    Metric,
}
