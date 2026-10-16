using Wheelhouse.Api.Calendar;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// Google, as far as the API sees it: one shared account with four calendars, whose events a
/// test adds, changes and removes. Each change moves the calendar's sync token on, as Google's does.
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
    private readonly Dictionary<string, int> _versions = [];

    public void Put(string calendarId, GoogleEvent googleEvent)
    {
        var events = EventsOf(calendarId);
        events.RemoveAll(e => e.Id == googleEvent.Id);
        events.Add(googleEvent);
        Changed(calendarId);
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
        return Task.FromResult<IReadOnlyList<GoogleEvent>>([.. EventsOf(calendarId)]);
    }
}
