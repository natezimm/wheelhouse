using System.Security.Cryptography;
using System.Text;

namespace Wheelhouse.Api.Calendar;

/// <summary>
/// The version of a cached occurrence a screen saw: a hash of everything the screens show of it
/// and its calendar. It changes when someone else's save or a sync changes what the event says,
/// and not when only Google's etag moves, so a stale draft is refused without refusing an
/// up-to-date one.
/// </summary>
public static class EventVersion
{
    public static string Of(EventInstance row)
    {
        var text = string.Join('\u001f',
            row.CalendarSourceId, row.RecurringEventId, row.Title, row.Location,
            row.StartsAt?.UtcTicks, row.EndsAt?.UtcTicks, row.StartDate?.DayNumber, row.EndDate?.DayNumber,
            row.Description, row.Recurrence, string.Join(',', row.MemberIds.Order()), row.IsPrivate, row.Countdown);
        return Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(text)), 0, 12)
            .Replace('+', '-').Replace('/', '_');
    }
}
