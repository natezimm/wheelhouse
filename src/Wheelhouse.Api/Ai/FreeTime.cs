namespace Wheelhouse.Api.Ai;

/// <summary>A stretch of time someone is taken: a timed event, with the people it is for (none for the whole family).</summary>
public sealed record BusyTime(DateTimeOffset Start, DateTimeOffset End, IReadOnlyCollection<Guid> People);

/// <summary>A stretch of time nobody asked about is taken.</summary>
public sealed record FreeSlot(DateTimeOffset Start, DateTimeOffset End);

/// <summary>
/// Free time, worked out in C# so the model can never make up a slot: the gaps of at least a given
/// length between the busy times of the people asked about. Pure and instant-based, so the family's
/// zone and its daylight-saving days are the caller's, which passes the range as instants.
/// </summary>
public static class FreeTime
{
    /// <summary>
    /// Whether <paramref name="busy"/> takes any of <paramref name="people"/>. An event for nobody in
    /// particular is the whole family's, so it takes everyone.
    /// </summary>
    public static bool Takes(BusyTime busy, IReadOnlySet<Guid> people) =>
        busy.People.Count == 0 || busy.People.Any(people.Contains);

    /// <summary>
    /// The gaps of at least <paramref name="minimum"/> between <paramref name="from"/> and
    /// <paramref name="to"/> when none of <paramref name="people"/> is busy, earliest first.
    /// </summary>
    public static IReadOnlyList<FreeSlot> Find(
        IEnumerable<BusyTime> busy, IReadOnlySet<Guid> people, DateTimeOffset from, DateTimeOffset to, TimeSpan minimum)
    {
        var slots = new List<FreeSlot>();
        if (to <= from)
        {
            return slots;
        }

        var taken = busy
            .Where(b => b.End > from && b.Start < to && b.End > b.Start && Takes(b, people))
            .OrderBy(b => b.Start)
            .ToList();

        var cursor = from;
        foreach (var b in taken)
        {
            if (b.Start > cursor && b.Start - cursor >= minimum)
            {
                slots.Add(new FreeSlot(cursor, b.Start));
            }

            if (b.End > cursor)
            {
                cursor = b.End;
            }
        }

        if (to > cursor && to - cursor >= minimum)
        {
            slots.Add(new FreeSlot(cursor, to));
        }

        return slots;
    }
}
