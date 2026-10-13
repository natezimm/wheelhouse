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

    public List<Member> Members { get; } = [];
}

public enum Units
{
    Imperial,
    Metric,
}
