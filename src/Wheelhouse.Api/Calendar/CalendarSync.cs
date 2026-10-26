using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Calendar;

/// <summary>
/// Brings a family's cached events up to date with its Google calendars. Each calendar is first
/// asked what changed since its sync token, which is cheap when nothing did; only then, or once a
/// day as the window moves, are its events in the window read in full and the cache replaced.
/// </summary>
/// <remarks>
/// It runs with no request, so it reads past the family query filters and names the family on
/// every query.
/// </remarks>
public sealed class CalendarSync(
    WheelhouseDbContext db,
    GoogleTokens tokens,
    IGoogleCalendar google,
    TimeProvider time,
    ILogger<CalendarSync> logger)
{
    /// <summary>How far back the cache reaches: the last three months, for looking back at what happened.</summary>
    public static readonly TimeSpan Behind = TimeSpan.FromDays(90);

    /// <summary>How far ahead the cache reaches: a little over a year, so next summer's trip is already there.</summary>
    public static readonly TimeSpan Ahead = TimeSpan.FromDays(400);

    /// <summary>How often the window is read in full even when Google reports no change.</summary>
    public static readonly TimeSpan ListEvery = TimeSpan.FromDays(1);

    /// <summary>The families whose Google connection is working, which a sync pass goes through.</summary>
    public Task<List<Guid>> ConnectedFamiliesAsync(CancellationToken cancellationToken) =>
        db.GoogleConnections
            .IgnoreQueryFilters()
            .Where(c => c.Status == GoogleConnectionStatus.Connected)
            .Select(c => c.FamilyId)
            .ToListAsync(cancellationToken);

    /// <summary>
    /// Syncs every calendar of <paramref name="familyId"/>. A calendar the account can no longer
    /// see is skipped and keeps what it had; a refused grant marks the connection
    /// <see cref="GoogleConnectionStatus.NeedsReauth"/> and stops. Network errors are thrown, for
    /// the next pass to try again.
    /// </summary>
    /// <returns>False when the connection needs a parent to connect again.</returns>
    public async Task<bool> SyncFamilyAsync(Guid familyId, CancellationToken cancellationToken)
    {
        var connection = await db.GoogleConnections
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(c => c.FamilyId == familyId, cancellationToken);
        if (connection is null)
        {
            return true;
        }

        if (connection.Status == GoogleConnectionStatus.NeedsReauth)
        {
            return false;
        }

        string accessToken;
        try
        {
            accessToken = await google.AccessTokenAsync(tokens.Unprotect(connection.EncryptedRefreshToken), cancellationToken);
        }
        catch (Exception exception) when (exception is GoogleGrantRevokedException or CryptographicException)
        {
            // Either Google refused the grant or the key that encrypted it is gone; both need a new consent.
            logger.LogWarning(exception, "The Google connection of family {FamilyId} needs connecting again", familyId);
            connection.Status = GoogleConnectionStatus.NeedsReauth;
            await db.SaveChangesAsync(cancellationToken);
            return false;
        }

        var sources = await db.CalendarSources
            .IgnoreQueryFilters()
            .Where(s => s.FamilyId == familyId)
            .ToListAsync(cancellationToken);
        foreach (var source in sources)
        {
            try
            {
                await SyncCalendarAsync(source, accessToken, cancellationToken);
            }
            catch (GoogleCalendarGoneException exception)
            {
                // A parent can choose it again or remove it in Settings; until then its events stay as they were.
                logger.LogWarning(exception, "Calendar {CalendarSourceId} of family {FamilyId} is no longer in Google", source.Id, familyId);
            }
        }

        return true;
    }

    private async Task SyncCalendarAsync(CalendarSource source, string accessToken, CancellationToken cancellationToken)
    {
        // Asking what changed comes first, so a change made while the window is read shows next time.
        GoogleChanges changes;
        try
        {
            changes = await google.ListChangesAsync(accessToken, source.GoogleCalendarId, source.SyncToken, cancellationToken);
        }
        catch (GoogleSyncTokenExpiredException)
        {
            logger.LogInformation("Google invalidated the sync token of calendar {CalendarSourceId}; reading it in full", source.Id);
            changes = await google.ListChangesAsync(accessToken, source.GoogleCalendarId, syncToken: null, cancellationToken);
        }

        var now = time.GetUtcNow();
        if (changes.Changed || source.ListedAt is not { } listedAt || now - listedAt >= ListEvery)
        {
            await ListAsync(source, accessToken, cancellationToken);
        }

        source.SyncToken = changes.NextSyncToken;
        source.LastSyncedAt = now;
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Reads the calendar's events in the window and replaces its cache with them, without saving.
    /// A screen's change to a whole series does this at once, since Google gives every occurrence
    /// a new version, and often a new id.
    /// </summary>
    public async Task ListAsync(CalendarSource source, string accessToken, CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var events = await google.ListEventsAsync(accessToken, source.GoogleCalendarId, now - Behind, now + Ahead, cancellationToken);
        await ReplaceEventsAsync(source, events, cancellationToken);
        source.ListedAt = now;
    }

    /// <summary>
    /// The family's days the cache holds in full, from the first up to, not including, the last;
    /// null when the family has no Google calendars that have been read, as on the demo. Each
    /// calendar was read around its own <see cref="CalendarSource.ListedAt"/>, so the days are the
    /// ones every calendar covers.
    /// </summary>
    public static (DateOnly From, DateOnly To)? Window(IEnumerable<DateTimeOffset> listedAt, TimeZoneInfo zone)
    {
        var listed = listedAt.ToList();
        if (listed.Count == 0)
        {
            return null;
        }

        // The day the window starts in is only partly read, so it starts the next day; the day it ends in is the exclusive end.
        var from = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(listed.Max() - Behind, zone).DateTime).AddDays(1);
        var to = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(listed.Min() + Ahead, zone).DateTime);
        return (from, to);
    }

    /// <summary>Makes the calendar's cached events exactly <paramref name="events"/>, keeping the rows of those already there.</summary>
    private async Task ReplaceEventsAsync(CalendarSource source, IReadOnlyList<GoogleEvent> events, CancellationToken cancellationToken)
    {
        var cached = await db.EventInstances
            .IgnoreQueryFilters()
            .Where(e => e.CalendarSourceId == source.Id)
            .ToDictionaryAsync(e => e.GoogleEventId, cancellationToken);

        var fresh = events.DistinctBy(e => e.Id).ToDictionary(e => e.Id);
        db.EventInstances.RemoveRange(cached.Values.Where(e => !fresh.ContainsKey(e.GoogleEventId)));

        foreach (var googleEvent in fresh.Values)
        {
            if (!cached.TryGetValue(googleEvent.Id, out var row))
            {
                row = new EventInstance
                {
                    Id = Guid.CreateVersion7(),
                    FamilyId = source.FamilyId,
                    CalendarSourceId = source.Id,
                    GoogleEventId = googleEvent.Id,
                    Title = "",
                };
                db.EventInstances.Add(row);
            }

            CopyTo(row, googleEvent);
        }
    }

    /// <summary>Sets a cached row to the occurrence as Google has it, for a sync or after a change made from a screen.</summary>
    public static void CopyTo(EventInstance row, GoogleEvent google)
    {
        row.RecurringEventId = google.RecurringEventId;
        row.ETag = google.ETag;
        row.Title = Limit(google.Title)!;
        row.Location = Limit(google.Location);
        row.StartsAt = google.StartsAt;
        row.EndsAt = google.EndsAt;
        row.StartDate = google.StartDate;
        row.EndDate = google.EndDate;
    }

    /// <summary>Google allows longer text than the cache's columns; the screens never show that much.</summary>
    private static string? Limit(string? text) => text is { Length: > 1024 } ? text[..1024] : text;
}
