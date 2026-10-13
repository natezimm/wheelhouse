namespace Wheelhouse.Api.Demo;

public static class NightlySchedule
{
    /// <summary>
    /// The next instant strictly after <paramref name="now"/> at which the wall clock in
    /// <paramref name="zone"/> reads <paramref name="at"/>.
    /// </summary>
    public static DateTimeOffset NextRun(DateTimeOffset now, TimeZoneInfo zone, TimeOnly at)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, zone).DateTime);
        var next = InstantOf(today, at, zone);
        return next > now ? next : InstantOf(today.AddDays(1), at, zone);
    }

    private static DateTimeOffset InstantOf(DateOnly date, TimeOnly time, TimeZoneInfo zone)
    {
        var local = date.ToDateTime(time, DateTimeKind.Unspecified);

        // On the night clocks spring forward, a time inside the skipped hour does not exist.
        // Run at the first moment after the gap instead of skipping the night.
        while (zone.IsInvalidTime(local))
        {
            local = local.AddMinutes(30);
        }

        return new DateTimeOffset(local, zone.GetUtcOffset(local));
    }
}
