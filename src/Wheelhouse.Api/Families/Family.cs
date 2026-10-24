using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Chores;
using Wheelhouse.Api.Devices;

namespace Wheelhouse.Api.Families;

public sealed class Family
{
    public Guid Id { get; set; }

    public required string Name { get; set; }

    /// <summary>IANA zone id such as <c>America/New_York</c>. Every screen renders times in this zone.</summary>
    public required string TimeZone { get; set; }

    /// <summary>
    /// The durable version of this family's cached calendar. The database context advances it
    /// atomically with calendar changes; clients compare it with their last complete snapshot.
    /// </summary>
    public long CalendarChangeNumber { get; private set; }

    public long ChoresChangeNumber { get; private set; }

    public long ListsChangeNumber { get; private set; }
    public long MealsChangeNumber { get; private set; }
    public List<Wheelhouse.Api.Meals.MealSlot> Meals { get; } = [];
    public List<Wheelhouse.Api.Meals.Recipe> Recipes { get; } = [];
    public List<Wheelhouse.Api.Meals.GroceryBatch> GroceryBatches { get; } = [];
    public List<Wheelhouse.Api.Lists.HouseholdList> Lists { get; } = [];

    public List<Chore> Chores { get; } = [];

    public DayOfWeek WeekStartsOn { get; set; } = DayOfWeek.Monday;

    /// <summary>
    /// Between these two local times every screen turns to its theme's dark look, when
    /// <see cref="NightMode"/> is <see cref="NightMode.AtNight"/>.
    /// </summary>
    public TimeOnly NightModeFrom { get; set; } = new(21, 30);

    public TimeOnly NightModeTo { get; set; } = new(6, 30);

    /// <summary>How every screen of the family looks, wall and phones alike.</summary>
    public Theme Theme { get; set; } = Theme.Daylight;

    /// <summary>When screens use their theme's dark look: never, during the night hours, or always.</summary>
    public NightMode NightMode { get; set; } = NightMode.AtNight;

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

    /// <summary>The Google calendars the family shows.</summary>
    public List<CalendarSource> Calendars { get; } = [];
}

public enum Theme
{
    Daylight,
    Groovy,
    Classic,
    Bold,
}

/// <summary>When every screen turns to its theme's dark look.</summary>
public enum NightMode
{
    Off,
    AtNight,
    Always,
}

public enum Units
{
    Imperial,
    Metric,
}

