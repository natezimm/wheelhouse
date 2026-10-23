using System.Text.RegularExpressions;

namespace Wheelhouse.Api.Families;

public sealed record FamilyResponse(
    Guid Id,
    string Name,
    string TimeZone,
    DayOfWeek WeekStartsOn,
    TimeOnly NightModeFrom,
    TimeOnly NightModeTo,
    Theme Theme,
    bool AutoNight,
    Units Units,
    double? Latitude,
    double? Longitude,
    IReadOnlyList<MemberResponse> Members)
{
    public static FamilyResponse From(Family family) => new(
        family.Id,
        family.Name,
        family.TimeZone,
        family.WeekStartsOn,
        family.NightModeFrom,
        family.NightModeTo,
        family.Theme,
        family.AutoNight,
        family.Units,
        family.Latitude,
        family.Longitude,
        [.. family.Members.Select(MemberResponse.From)]);
}

public sealed record MemberResponse(Guid Id, string DisplayName, string Color, string Initial, MemberRole Role)
{
    public static MemberResponse From(Member member) =>
        new(member.Id, member.DisplayName, member.Color, member.Initial, member.Role);
}

public sealed record FamilySettingsRequest(
    string Name,
    string TimeZone,
    DayOfWeek WeekStartsOn,
    TimeOnly NightModeFrom,
    TimeOnly NightModeTo,
    Units Units)
{
    /// <summary>Errors by field name, in the shape of a validation problem. Empty when valid.</summary>
    public Dictionary<string, string[]> Validate()
    {
        var errors = new Dictionary<string, string[]>();

        if (string.IsNullOrWhiteSpace(Name) || Name.Trim().Length > 100)
        {
            errors["name"] = ["Enter a family name of up to 100 characters."];
        }

        if (string.IsNullOrWhiteSpace(TimeZone) || !TimeZoneInfo.TryFindSystemTimeZoneById(TimeZone, out _))
        {
            errors["timeZone"] = ["Choose a time zone from the list."];
        }

        if (WeekStartsOn is not (DayOfWeek.Sunday or DayOfWeek.Monday))
        {
            errors["weekStartsOn"] = ["A week starts on Sunday or Monday."];
        }

        if (NightModeFrom == NightModeTo)
        {
            errors["nightModeTo"] = ["Night mode needs a different start and end time."];
        }

        if (!Enum.IsDefined(Units))
        {
            errors["units"] = ["Choose Imperial or Metric."];
        }

        return errors;
    }
}

/// <summary>The family's theme, and whether screens turn dark at night.</summary>
public sealed record FamilyThemeRequest(Theme Theme, bool AutoNight)
{
    public Dictionary<string, string[]> Validate()
    {
        var errors = new Dictionary<string, string[]>();

        if (!Enum.IsDefined(Theme))
        {
            errors["theme"] = ["Choose Daylight, Groovy, Classic or Bold."];
        }

        return errors;
    }
}

/// <summary>Where the weather is for. Both null clears it.</summary>
public sealed record FamilyLocationRequest(double? Latitude, double? Longitude)
{
    public Dictionary<string, string[]> Validate()
    {
        var errors = new Dictionary<string, string[]>();

        if (Latitude is null != Longitude is null)
        {
            errors["latitude"] = ["Give both a latitude and a longitude, or neither."];
        }

        if (Latitude is < -90 or > 90 || Latitude is double.NaN)
        {
            errors["latitude"] = ["A latitude is between -90 and 90."];
        }

        if (Longitude is < -180 or > 180 || Longitude is double.NaN)
        {
            errors["longitude"] = ["A longitude is between -180 and 180."];
        }

        return errors;
    }
}

public sealed partial record MemberRequest(string DisplayName, string Color, MemberRole Role)
{
    public Dictionary<string, string[]> Validate()
    {
        var errors = new Dictionary<string, string[]>();

        if (string.IsNullOrWhiteSpace(DisplayName) || DisplayName.Trim().Length > 50)
        {
            errors["displayName"] = ["Enter a name of up to 50 characters."];
        }

        if (Color is null || !HexColor().IsMatch(Color))
        {
            errors["color"] = ["Choose a color."];
        }

        if (!Enum.IsDefined(Role))
        {
            errors["role"] = ["Choose Parent or Kid."];
        }

        return errors;
    }

    /// <summary>The first letter of the name, upper-cased, for the member's avatar.</summary>
    public static string InitialOf(string displayName)
    {
        var name = displayName.Trim();
        // Keep both halves of a character outside the basic plane, such as an emoji.
        var length = char.IsHighSurrogate(name[0]) && name.Length > 1 ? 2 : 1;
        return name[..length].ToUpperInvariant();
    }

    [GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial Regex HexColor();
}
