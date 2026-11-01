using Wheelhouse.Api.Calendar;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// Google, as far as the API sees it: one shared account with four calendars, whose events a
/// test adds, changes and removes. Each change moves the calendar's sync token on, as Google's does.
/// A series is kept as its first event and a rule, and expanded into occurrences when read, with
/// ids and versions made the way Google makes them; an occurrence changed on its own is kept as
/// an event of its own, as Google keeps it.
/// </summary>
internal sealed class FakeGoogle : IGoogleCalendar
{
    public const string Account = "family.calendars@example.com";

    public const string Full = $"openid email {GoogleConnectionEndpoints.CalendarScope}";

    public string Email { get; set; } = Account;
    public string Scopes { get; set; } = Full;
    public bool Revoked { get; set; }
    public List<(string Code, string RedirectUri)> Exchanged { get; } = [];
    public List<string> RevokedTokens { get; } = [];
    public string? LastRefreshToken { get; private set; }

    /// <summary>Calendars the account can no longer see.</summary>
    public HashSet<string> Gone { get; } = [];

    /// <summary>Sync tokens Google has invalidated, which it answers with 410 Gone.</summary>
    public HashSet<string> Expired { get; } = [];

    /// <summary>Every full read of a calendar's events: the calendar and the window asked for.</summary>
    public List<(string CalendarId, DateTimeOffset From, DateTimeOffset To)> Listed { get; } = [];

    private readonly Dictionary<string, List<GoogleEvent>> _events = [];
    private readonly Dictionary<string, (string Rule, string TimeZone)> _series = [];
    private readonly HashSet<string> _cancelled = [];
    private readonly Dictionary<string, int> _versions = [];

    /// <summary>Every change a screen made in Google: what was done, to which calendar and event, and the etag it sent.</summary>
    public List<(string Change, string CalendarId, string EventId, string? IfMatch)> Writes { get; } = [];

    /// <summary>Adds or replaces an event, as if changed in Google Calendar itself, with a new etag.</summary>
    public void Put(string calendarId, GoogleEvent googleEvent)
    {
        var events = EventsOf(calendarId);
        events.RemoveAll(e => e.Id == googleEvent.Id);
        events.Add(googleEvent with { ETag = $"\"{Guid.NewGuid():N}\"" });
        Changed(calendarId);
    }

    /// <summary>Adds a series starting with <paramref name="first"/>, repeating by <paramref name="rule"/>, as if made in Google Calendar.</summary>
    public void PutSeries(string calendarId, GoogleEvent first, string rule, string timeZone)
    {
        _series[first.Id] = (rule, timeZone);
        Put(calendarId, first);
    }

    /// <summary>The rule of a series, or null for an event that does not repeat.</summary>
    public string? RuleOf(string eventId) => _series.TryGetValue(eventId, out var series) ? series.Rule : null;

    /// <summary>The event, series or occurrence as Google has it now.</summary>
    public GoogleEvent? Find(string calendarId, string eventId) =>
        // Google gives a series' rule only on its first event.
        EventsOf(calendarId).SingleOrDefault(e => e.Id == eventId) is { } stored ? stored with { Recurrence = RuleOf(eventId) }
        : Expanded(calendarId, DateTimeOffset.MinValue, DateTimeOffset.MaxValue).FirstOrDefault(e => e.Id == eventId);

    /// <summary>The calendar's events as the screens see them, with each series expanded into its occurrences.</summary>
    public IEnumerable<GoogleEvent> Occurrences(string calendarId, DateTimeOffset from, DateTimeOffset to) =>
        EventsOf(calendarId).Where(e => !_series.ContainsKey(e.Id)).Concat(Expanded(calendarId, from, to));

    private IEnumerable<GoogleEvent> Expanded(string calendarId, DateTimeOffset from, DateTimeOffset to)
    {
        var events = EventsOf(calendarId);
        foreach (var first in events.Where(e => _series.ContainsKey(e.Id)).ToList())
        {
            var (rule, timeZone) = _series[first.Id];
            var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
            var draft = new GoogleEventDraft(first.Title, first.Location, first.StartsAt, first.EndsAt, first.StartDate, first.EndDate, timeZone,
                Recurrence: rule, Description: first.Description, MemberIds: first.MemberIds, Private: first.Private, Countdown: first.Countdown);
            // Two years of occurrences is more than any test reads.
            var until = DateOnly.FromDateTime((first.StartsAt?.UtcDateTime ?? first.StartDate!.Value.ToDateTime(TimeOnly.MinValue)).AddYears(2));
            foreach (var occurrence in EventSeries.Occurrences(draft, first.Id, until, zone))
            {
                var id = occurrence.StartsAt is { } startsAt ? $"{first.Id}_{startsAt.UtcDateTime:yyyyMMdd'T'HHmmss'Z'}" : occurrence.Id;
                var start = occurrence.StartsAt ?? new DateTimeOffset(occurrence.StartDate!.Value.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
                if (start >= to)
                {
                    break;
                }

                if (start >= from && !_cancelled.Contains(id) && events.All(e => e.Id != id))
                {
                    yield return occurrence with { Id = id, ETag = $"{first.ETag}{id}", Recurrence = null };
                }
            }
        }
    }

    public void Remove(string calendarId, string eventId)
    {
        EventsOf(calendarId).RemoveAll(e => e.Id == eventId);
        Changed(calendarId);
    }

    /// <summary>The token Google would give for the calendar as it is now.</summary>
    public string SyncTokenOf(string calendarId) => $"{calendarId}@{_versions.GetValueOrDefault(calendarId)}";

    private List<GoogleEvent> EventsOf(string calendarId) =>
        _events.TryGetValue(calendarId, out var events) ? events : _events[calendarId] = [];

    private void Changed(string calendarId) => _versions[calendarId] = _versions.GetValueOrDefault(calendarId) + 1;

    public Task<GoogleGrant> ExchangeCodeAsync(string code, string redirectUri, CancellationToken cancellationToken)
    {
        Exchanged.Add((code, redirectUri));
        return Task.FromResult(new GoogleGrant($"refresh-{code}", Email, Scopes));
    }

    public Task<IReadOnlyList<GoogleCalendarEntry>> ListCalendarsAsync(string refreshToken, CancellationToken cancellationToken)
    {
        LastRefreshToken = refreshToken;
        if (Revoked)
        {
            throw new GoogleGrantRevokedException();
        }

        return Task.FromResult<IReadOnlyList<GoogleCalendarEntry>>(
        [
            new("holidays", "Holidays", "#16a765", CanWrite: false, Primary: false),
            new("family-cal", "Family", "#4986e7", CanWrite: true, Primary: false),
            new("primary", "Shared account", "#9fc6e7", CanWrite: true, Primary: true),
            new("alex-cal", "Alex", "#f83a22", CanWrite: true, Primary: false),
        ]);
    }

    public Task RevokeAsync(string refreshToken, CancellationToken cancellationToken)
    {
        RevokedTokens.Add(refreshToken);
        return Task.CompletedTask;
    }

    public Task<string> AccessTokenAsync(string refreshToken, CancellationToken cancellationToken)
    {
        LastRefreshToken = refreshToken;
        return Revoked ? throw new GoogleGrantRevokedException() : Task.FromResult($"access-{refreshToken}");
    }

    public Task<GoogleChanges> ListChangesAsync(string accessToken, string calendarId, string? syncToken, CancellationToken cancellationToken)
    {
        if (Gone.Contains(calendarId))
        {
            throw new GoogleCalendarGoneException(calendarId);
        }

        if (syncToken is not null && Expired.Contains(syncToken))
        {
            throw new GoogleSyncTokenExpiredException();
        }

        var current = SyncTokenOf(calendarId);
        return Task.FromResult(new GoogleChanges(syncToken != current, current));
    }

    public Task<IReadOnlyList<GoogleEvent>> ListEventsAsync(
        string accessToken, string calendarId, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken)
    {
        if (Gone.Contains(calendarId))
        {
            throw new GoogleCalendarGoneException(calendarId);
        }

        Listed.Add((calendarId, from, to));
        IReadOnlyList<GoogleEvent> listed = [.. Occurrences(calendarId, from - TimeSpan.FromDays(1), to)];
        return AfterListing is { } after ? AnswerLate(after, listed) : Task.FromResult(listed);
    }

    /// <summary>Runs once a calendar's events are read and before they are answered, as when a save lands while Google's answer is on its way.</summary>
    public Func<Task>? AfterListing { get; set; }

    private async Task<IReadOnlyList<GoogleEvent>> AnswerLate(Func<Task> after, IReadOnlyList<GoogleEvent> listed)
    {
        AfterListing = null;
        await after();
        return listed;
    }

    public Task<GoogleEvent> InsertEventAsync(string accessToken, string calendarId, GoogleEventDraft draft, CancellationToken cancellationToken)
    {
        if (Gone.Contains(calendarId))
        {
            throw new GoogleCalendarGoneException(calendarId);
        }

        var id = draft.Id ?? $"new-{Guid.NewGuid():N}";
        if (Find(calendarId, id) is { } existing) return Task.FromResult(existing);
        Writes.Add(("insert", calendarId, id, null));
        if (draft.Recurrence is { } rule)
        {
            _series[id] = (rule, draft.TimeZone);
        }

        Put(calendarId, From(draft, id, recurringEventId: null));
        return Task.FromResult(Find(calendarId, id)!);
    }

    public Task<GoogleEvent> PatchEventAsync(
        string accessToken, string calendarId, string eventId, string? etag, GoogleEventDraft draft, CancellationToken cancellationToken)
    {
        Writes.Add(("patch", calendarId, eventId, etag));
        var current = Current(calendarId, eventId, etag);
        if (draft.Recurrence is { } rule)
        {
            _series[eventId] = (rule, draft.TimeZone);
        }

        // A patch leaves out what it does not set, so notes and people not sent stay as they were.
        Put(calendarId, From(draft, eventId, current.RecurringEventId) with
        {
            Description = draft.Description is null ? current.Description : draft.Description is "" ? null : draft.Description,
            MemberIds = draft.MemberIds ?? current.MemberIds,
            Private = draft.Private ?? current.Private,
            Countdown = draft.Countdown ?? current.Countdown,
        });
        return Task.FromResult(Find(calendarId, eventId)!);
    }

    public Task<GoogleEvent> MoveEventAsync(
        string accessToken, string calendarId, string eventId, string toCalendarId, CancellationToken cancellationToken)
    {
        Writes.Add(("move", calendarId, eventId, null));
        var current = Current(calendarId, eventId, etag: null);
        Remove(calendarId, eventId);
        Put(toCalendarId, current);
        // A series takes its occurrences that were changed on their own along.
        foreach (var changedAlone in EventsOf(calendarId).Where(e => e.RecurringEventId == eventId).ToList())
        {
            Remove(calendarId, changedAlone.Id);
            Put(toCalendarId, changedAlone);
        }
        return Task.FromResult(Find(toCalendarId, eventId)!);
    }

    public Task DeleteEventAsync(string accessToken, string calendarId, string eventId, string? etag, CancellationToken cancellationToken)
    {
        Writes.Add(("delete", calendarId, eventId, etag));
        if (Find(calendarId, eventId) is { } found)
        {
            Current(calendarId, eventId, etag);
            Remove(calendarId, eventId);
            if (found.RecurringEventId is not null)
            {
                _cancelled.Add(eventId);
            }

            EventsOf(calendarId).RemoveAll(e => e.RecurringEventId == eventId);
            _series.Remove(eventId);
        }

        return Task.CompletedTask;
    }

    public Task<GoogleEvent?> GetEventAsync(string accessToken, string calendarId, string eventId, CancellationToken cancellationToken) =>
        Task.FromResult(Find(calendarId, eventId));

    /// <summary>The event as Google has it, refusing a change made against an older version as Google does.</summary>
    private GoogleEvent Current(string calendarId, string eventId, string? etag)
    {
        if (Gone.Contains(calendarId))
        {
            throw new GoogleCalendarGoneException(calendarId);
        }

        var current = Find(calendarId, eventId) ?? throw new GoogleEventGoneException(eventId);
        return etag is not null && etag != current.ETag ? throw new GoogleEventChangedException(eventId) : current;
    }

    private static GoogleEvent From(GoogleEventDraft draft, string id, string? recurringEventId) =>
        new(id, recurringEventId, draft.Title, draft.Location, draft.StartsAt, draft.EndsAt, draft.StartDate, draft.EndDate,
            Description: string.IsNullOrEmpty(draft.Description) ? null : draft.Description, MemberIds: draft.MemberIds ?? [], Private: draft.Private ?? false, Countdown: draft.Countdown ?? false);
}
