using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;

namespace Wheelhouse.Api.Calendar;

/// <summary>
/// What the API asks of Google Calendar. <see cref="GoogleCalendarApi"/> calls Google; the tests
/// replace it with a fake, and the demo never reaches it.
/// </summary>
public interface IGoogleCalendar
{
    /// <summary>Trades the code Google's consent screen sent back for the account's tokens.</summary>
    Task<GoogleGrant> ExchangeCodeAsync(string code, string redirectUri, CancellationToken cancellationToken);

    /// <summary>The calendars the account can see, as its calendar list has them.</summary>
    /// <exception cref="GoogleGrantRevokedException">Google no longer accepts the refresh token.</exception>
    Task<IReadOnlyList<GoogleCalendarEntry>> ListCalendarsAsync(string refreshToken, CancellationToken cancellationToken);

    /// <summary>Tells Google to forget the grant, so the account no longer lists the app as having access.</summary>
    Task RevokeAsync(string refreshToken, CancellationToken cancellationToken);

    /// <summary>A short-lived access token for the calls below.</summary>
    /// <exception cref="GoogleGrantRevokedException">Google no longer accepts the refresh token.</exception>
    Task<string> AccessTokenAsync(string refreshToken, CancellationToken cancellationToken);

    /// <summary>
    /// Whether anything in the calendar changed since <paramref name="syncToken"/>, and the token
    /// to ask with next time. Without a token it reads the whole calendar once to get the first one
    /// (https://developers.google.com/calendar/api/guides/sync).
    /// </summary>
    /// <exception cref="GoogleSyncTokenExpiredException">Google invalidated the sync token.</exception>
    /// <exception cref="GoogleCalendarGoneException">The account can no longer see the calendar.</exception>
    Task<GoogleChanges> ListChangesAsync(string accessToken, string calendarId, string? syncToken, CancellationToken cancellationToken);

    /// <summary>
    /// Every occurrence that overlaps <paramref name="from"/> to <paramref name="to"/>, with
    /// recurring events expanded by Google. Cancelled occurrences are left out.
    /// </summary>
    /// <exception cref="GoogleCalendarGoneException">The account can no longer see the calendar.</exception>
    Task<IReadOnlyList<GoogleEvent>> ListEventsAsync(
        string accessToken, string calendarId, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken);

    /// <summary>
    /// Adds an event to the calendar and returns it as Google stored it. A series comes back as
    /// its first event, under the series' id; its occurrences have ids of their own.
    /// </summary>
    /// <exception cref="GoogleCalendarGoneException">The account can no longer see or change the calendar.</exception>
    Task<GoogleEvent> InsertEventAsync(string accessToken, string calendarId, GoogleEventDraft draft, CancellationToken cancellationToken);

    /// <summary>
    /// Changes an event's title, place and times, leaving everything else about it (its
    /// description, guests, reminders) as it was. With <paramref name="etag"/> Google refuses the
    /// change if the event changed since that version
    /// (https://developers.google.com/calendar/api/guides/version-resources).
    /// </summary>
    /// <exception cref="GoogleEventChangedException">The event changed in Google since <paramref name="etag"/>.</exception>
    /// <exception cref="GoogleEventGoneException">The event was deleted.</exception>
    /// <exception cref="GoogleCalendarGoneException">The account can no longer change the calendar.</exception>
    Task<GoogleEvent> PatchEventAsync(
        string accessToken, string calendarId, string eventId, string? etag, GoogleEventDraft draft, CancellationToken cancellationToken);

    /// <summary>Moves an event to another of the account's calendars, keeping its id.</summary>
    /// <exception cref="GoogleEventGoneException">The event was deleted.</exception>
    /// <exception cref="GoogleCalendarGoneException">The account can no longer change one of the calendars.</exception>
    Task<GoogleEvent> MoveEventAsync(
        string accessToken, string calendarId, string eventId, string toCalendarId, CancellationToken cancellationToken);

    /// <summary>Deletes an event, or one occurrence of a recurring one. An event already deleted counts as done.</summary>
    /// <exception cref="GoogleEventChangedException">The event changed in Google since <paramref name="etag"/>.</exception>
    /// <exception cref="GoogleCalendarGoneException">The account can no longer change the calendar.</exception>
    Task DeleteEventAsync(string accessToken, string calendarId, string eventId, string? etag, CancellationToken cancellationToken);

    /// <summary>The event as Google has it now, or null when it was deleted or cancelled.</summary>
    Task<GoogleEvent?> GetEventAsync(string accessToken, string calendarId, string eventId, CancellationToken cancellationToken);
}

public sealed record GoogleChanges(bool Changed, string NextSyncToken);

/// <summary>
/// One occurrence, timed (<paramref name="StartsAt"/>, <paramref name="EndsAt"/>) or all-day
/// (<paramref name="StartDate"/> and an exclusive <paramref name="EndDate"/>).
/// <paramref name="ETag"/> is Google's version of it. <paramref name="Description"/> is Google's,
/// which may hold HTML. <paramref name="Recurrence"/> is the series' rule (RFC 5545, such as
/// <c>RRULE:FREQ=WEEKLY;BYDAY=TU,TH</c>), which Google keeps on the series' first event only.
/// </summary>
public sealed record GoogleEvent(
    string Id,
    string? RecurringEventId,
    string Title,
    string? Location,
    DateTimeOffset? StartsAt,
    DateTimeOffset? EndsAt,
    DateOnly? StartDate,
    DateOnly? EndDate,
    string? ETag = null,
    string? Description = null,
    string? Recurrence = null);

/// <summary>
/// What the screens set on an event: timed (<paramref name="StartsAt"/>, <paramref name="EndsAt"/>)
/// or all-day (<paramref name="StartDate"/> and an exclusive <paramref name="EndDate"/>). A timed
/// event is given the family's <paramref name="TimeZone"/>, so Google shows it at the family's time.
/// <paramref name="Recurrence"/> is the rule of a new series, which then starts with this event.
/// <paramref name="Description"/> replaces the event's notes, or with null leaves them as they are.
/// </summary>
public sealed record GoogleEventDraft(
    string Title,
    string? Location,
    DateTimeOffset? StartsAt,
    DateTimeOffset? EndsAt,
    DateOnly? StartDate,
    DateOnly? EndDate,
    string TimeZone,
    string? Recurrence = null,
    string? Id = null,
    string? Description = null);

/// <summary>Google answered 412: the event changed since the version the screen was editing.</summary>
public sealed class GoogleEventChangedException(string eventId) : Exception($"Event {eventId} changed in Google first.");

/// <summary>Google answered 404 or 410 for an event: it was deleted.</summary>
public sealed class GoogleEventGoneException(string eventId) : Exception($"Event {eventId} is no longer in Google.");

/// <summary>Google answered 410 Gone: the sync token is no good, and the calendar must be read in full again.</summary>
public sealed class GoogleSyncTokenExpiredException() : Exception("Google invalidated the calendar's sync token.");

/// <summary>Google answered 404 or 403 for a calendar: it was deleted, or is no longer shared with the account.</summary>
public sealed class GoogleCalendarGoneException(string calendarId) : Exception($"The account can no longer see calendar {calendarId}.");

/// <summary>What a finished consent gives the API. Google sends a refresh token only with offline access.</summary>
public sealed record GoogleGrant(string? RefreshToken, string Email, string Scopes);

/// <summary>One calendar in the account's list. <paramref name="CanWrite"/> is true for the owner and for writers.</summary>
public sealed record GoogleCalendarEntry(string Id, string Name, string? Color, bool CanWrite, bool Primary);

/// <summary>Google answered <c>invalid_grant</c>: the refresh token is no good any more.</summary>
public sealed class GoogleGrantRevokedException() : Exception("Google no longer accepts the family's Google connection.");

/// <summary>
/// Google's OAuth and Calendar REST endpoints over plain HTTP
/// (https://developers.google.com/identity/protocols/oauth2/web-server,
/// https://developers.google.com/calendar/api/v3/reference).
/// </summary>
public sealed class GoogleCalendarApi(HttpClient http, IOptions<GoogleSignInOptions> client) : IGoogleCalendar
{
    public const string TokenEndpoint = "https://oauth2.googleapis.com/token";
    public const string RevokeEndpoint = "https://oauth2.googleapis.com/revoke";
    public const string CalendarApi = "https://www.googleapis.com/calendar/v3/";

    public async Task<GoogleGrant> ExchangeCodeAsync(string code, string redirectUri, CancellationToken cancellationToken)
    {
        var tokens = await RequestTokensAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = redirectUri,
        }, cancellationToken);

        return new GoogleGrant(tokens.RefreshToken, EmailIn(tokens.IdToken), tokens.Scope ?? "");
    }

    public async Task<IReadOnlyList<GoogleCalendarEntry>> ListCalendarsAsync(string refreshToken, CancellationToken cancellationToken)
    {
        var accessToken = await AccessTokenAsync(refreshToken, cancellationToken);
        var calendars = new List<GoogleCalendarEntry>();
        string? pageToken = null;
        do
        {
            var url = $"{CalendarApi}users/me/calendarList?maxResults=250"
                + (pageToken is null ? "" : $"&pageToken={Uri.EscapeDataString(pageToken)}");
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            using var response = await http.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();

            var page = await response.Content.ReadFromJsonAsync<CalendarListPage>(cancellationToken)
                ?? throw new HttpRequestException("Google sent an empty calendar list.");
            calendars.AddRange((page.Items ?? []).Select(item => new GoogleCalendarEntry(
                item.Id,
                item.SummaryOverride ?? item.Summary ?? item.Id,
                item.BackgroundColor,
                item.AccessRole is "owner" or "writer",
                item.Primary)));
            pageToken = page.NextPageToken;
        }
        while (pageToken is not null);

        return calendars;
    }

    public async Task RevokeAsync(string refreshToken, CancellationToken cancellationToken)
    {
        using var response = await http.PostAsync(
            RevokeEndpoint,
            new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = refreshToken }),
            cancellationToken);
        // Already revoked counts as done.
        if (response.StatusCode != HttpStatusCode.BadRequest)
        {
            response.EnsureSuccessStatusCode();
        }
    }

    public async Task<GoogleChanges> ListChangesAsync(string accessToken, string calendarId, string? syncToken, CancellationToken cancellationToken)
    {
        var changed = false;
        string? pageToken = null;
        while (true)
        {
            // A sync token only works with the same parameters it was issued for, so these never change.
            var query = new Dictionary<string, string?>
            {
                ["maxResults"] = "2500",
                ["syncToken"] = syncToken,
                ["pageToken"] = pageToken,
            };
            var page = await GetEventsAsync(accessToken, calendarId, query, cancellationToken);
            changed |= syncToken is null || page.Items is { Count: > 0 };
            if (page.NextSyncToken is { } next)
            {
                return new GoogleChanges(changed, next);
            }

            pageToken = page.NextPageToken ?? throw new HttpRequestException("Google ended a sync without a sync token.");
        }
    }

    public async Task<IReadOnlyList<GoogleEvent>> ListEventsAsync(
        string accessToken, string calendarId, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken)
    {
        var events = new List<GoogleEvent>();
        string? pageToken = null;
        do
        {
            var page = await GetEventsAsync(accessToken, calendarId, new Dictionary<string, string?>
            {
                ["timeMin"] = from.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"),
                ["timeMax"] = to.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"),
                ["singleEvents"] = "true",
                ["maxResults"] = "2500",
                ["pageToken"] = pageToken,
            }, cancellationToken);
            events.AddRange((page.Items ?? []).Where(item => item.Status != "cancelled").Select(ToEvent).OfType<GoogleEvent>());
            pageToken = page.NextPageToken;
        }
        while (pageToken is not null);

        return events;
    }

    private async Task<EventsPage> GetEventsAsync(
        string accessToken, string calendarId, Dictionary<string, string?> query, CancellationToken cancellationToken)
    {
        var url = $"{CalendarApi}calendars/{Uri.EscapeDataString(calendarId)}/events"
            + QueryString.Create(query.Where(pair => pair.Value is not null));
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var response = await http.SendAsync(request, cancellationToken);

        switch (response.StatusCode)
        {
            case HttpStatusCode.Gone:
                throw new GoogleSyncTokenExpiredException();
            case HttpStatusCode.NotFound or HttpStatusCode.Forbidden:
                throw new GoogleCalendarGoneException(calendarId);
        }

        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<EventsPage>(cancellationToken)
            ?? throw new HttpRequestException("Google sent an empty page of events.");
    }

    public async Task<GoogleEvent> InsertEventAsync(string accessToken, string calendarId, GoogleEventDraft draft, CancellationToken cancellationToken)
    {
        var body = Body(draft);
        if (draft.Id is { } id) body["id"] = id;
        using var request = new HttpRequestMessage(HttpMethod.Post, EventsUrl(calendarId)) { Content = JsonContent.Create(body) };
        try
        {
            return await SendForEventAsync(request, accessToken, calendarId, eventId: null, cancellationToken);
        }
        catch (HttpRequestException exception) when (draft.Id is not null && exception.StatusCode == HttpStatusCode.Conflict)
        {
            // A response may have been lost after Google stored the first insert. The same id
            // always addresses that event, even if our cache never received it.
            return await GetEventAsync(accessToken, calendarId, draft.Id, cancellationToken)
                ?? throw new HttpRequestException("The original event is no longer available.", exception, HttpStatusCode.Conflict);
        }
    }

    public async Task<GoogleEvent> PatchEventAsync(
        string accessToken, string calendarId, string eventId, string? etag, GoogleEventDraft draft, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Patch, EventUrl(calendarId, eventId)) { Content = JsonContent.Create(Body(draft)) };
        IfMatch(request, etag);
        return await SendForEventAsync(request, accessToken, calendarId, eventId, cancellationToken);
    }

    public async Task<GoogleEvent> MoveEventAsync(
        string accessToken, string calendarId, string eventId, string toCalendarId, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post, $"{EventUrl(calendarId, eventId)}/move?destination={Uri.EscapeDataString(toCalendarId)}");
        return await SendForEventAsync(request, accessToken, calendarId, eventId, cancellationToken);
    }

    public async Task DeleteEventAsync(string accessToken, string calendarId, string eventId, string? etag, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, EventUrl(calendarId, eventId));
        IfMatch(request, etag);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var response = await http.SendAsync(request, cancellationToken);
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
        {
            return;
        }

        ThrowForEventStatus(response, calendarId, eventId);
        response.EnsureSuccessStatusCode();
    }

    public async Task<GoogleEvent?> GetEventAsync(string accessToken, string calendarId, string eventId, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, EventUrl(calendarId, eventId));
        try
        {
            return await SendForEventAsync(request, accessToken, calendarId, eventId, cancellationToken);
        }
        catch (GoogleEventGoneException)
        {
            return null;
        }
    }

    private static string EventsUrl(string calendarId) => $"{CalendarApi}calendars/{Uri.EscapeDataString(calendarId)}/events";

    private static string EventUrl(string calendarId, string eventId) => $"{EventsUrl(calendarId)}/{Uri.EscapeDataString(eventId)}";

    /// <summary>Google's etags carry their own quotes, so the header takes them as they are.</summary>
    private static void IfMatch(HttpRequestMessage request, string? etag)
    {
        if (etag is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", etag);
        }
    }

    /// <summary>
    /// A patch merges into the event, so a change between timed and all-day clears the other
    /// kind of time with an explicit null.
    /// </summary>
    private static Dictionary<string, object?> Body(GoogleEventDraft draft)
    {
        Dictionary<string, object?> Time(DateTimeOffset? instant, DateOnly? date) => instant is { } at
            ? new() { ["dateTime"] = at.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"), ["timeZone"] = draft.TimeZone, ["date"] = null }
            : new() { ["date"] = date!.Value.ToString("yyyy-MM-dd"), ["dateTime"] = null, ["timeZone"] = null };

        var body = new Dictionary<string, object?>
        {
            ["summary"] = draft.Title,
            ["location"] = draft.Location ?? "",
            ["start"] = Time(draft.StartsAt, draft.StartDate),
            ["end"] = Time(draft.EndsAt, draft.EndDate),
        };
        if (draft.Recurrence is { } rule)
        {
            body["recurrence"] = new[] { rule };
        }

        if (draft.Description is { } description)
        {
            body["description"] = description;
        }

        return body;
    }

    private async Task<GoogleEvent> SendForEventAsync(
        HttpRequestMessage request, string accessToken, string calendarId, string? eventId, CancellationToken cancellationToken)
    {
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var response = await http.SendAsync(request, cancellationToken);
        if (eventId is not null && response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
        {
            throw new GoogleEventGoneException(eventId);
        }

        ThrowForEventStatus(response, calendarId, eventId ?? "(new)");
        response.EnsureSuccessStatusCode();
        var item = await response.Content.ReadFromJsonAsync<EventItem>(cancellationToken)
            ?? throw new HttpRequestException("Google sent an empty event.");
        if (item.Status == "cancelled")
        {
            throw new GoogleEventGoneException(item.Id);
        }

        return ToEvent(item) ?? throw new HttpRequestException("Google sent an event with no start or end.");
    }

    private static void ThrowForEventStatus(HttpResponseMessage response, string calendarId, string eventId)
    {
        switch (response.StatusCode)
        {
            case HttpStatusCode.PreconditionFailed:
                throw new GoogleEventChangedException(eventId);
            case HttpStatusCode.NotFound or HttpStatusCode.Forbidden:
                throw new GoogleCalendarGoneException(calendarId);
        }
    }

    /// <summary>The series' repeat rule among Google's recurrence lines, which can also hold exception dates.</summary>
    private static string? RuleIn(List<string>? recurrence) =>
        recurrence?.FirstOrDefault(line => line.StartsWith("RRULE:", StringComparison.OrdinalIgnoreCase));

    /// <summary>An occurrence as the cache keeps it, or null for one with no usable start and end.</summary>
    private static GoogleEvent? ToEvent(EventItem item)
    {
        var title = string.IsNullOrWhiteSpace(item.Summary) ? "Busy" : item.Summary.Trim();
        var location = string.IsNullOrWhiteSpace(item.Location) ? null : item.Location.Trim();
        var description = string.IsNullOrWhiteSpace(item.Description) ? null : item.Description;
        if (item.Start?.Date is { } startDate && item.End?.Date is { } endDate)
        {
            return new GoogleEvent(item.Id, item.RecurringEventId, title, location, null, null,
                DateOnly.ParseExact(startDate, "yyyy-MM-dd"), DateOnly.ParseExact(endDate, "yyyy-MM-dd"), item.ETag,
                description, RuleIn(item.Recurrence));
        }

        if (item.Start?.DateTime is { } startsAt && item.End?.DateTime is { } endsAt)
        {
            return new GoogleEvent(item.Id, item.RecurringEventId, title, location, startsAt.ToUniversalTime(), endsAt.ToUniversalTime(), null, null, item.ETag,
                description, RuleIn(item.Recurrence));
        }

        return null;
    }

    public async Task<string> AccessTokenAsync(string refreshToken, CancellationToken cancellationToken)
    {
        var tokens = await RequestTokensAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
        }, cancellationToken);
        return tokens.AccessToken;
    }

    private async Task<TokenResponse> RequestTokensAsync(Dictionary<string, string> form, CancellationToken cancellationToken)
    {
        form["client_id"] = client.Value.ClientId ?? "";
        form["client_secret"] = client.Value.ClientSecret ?? "";
        using var response = await http.PostAsync(TokenEndpoint, new FormUrlEncodedContent(form), cancellationToken);

        if (response.StatusCode == HttpStatusCode.BadRequest)
        {
            var error = await response.Content.ReadFromJsonAsync<TokenError>(cancellationToken);
            if (error?.Error == "invalid_grant")
            {
                throw new GoogleGrantRevokedException();
            }
        }

        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<TokenResponse>(cancellationToken)
            ?? throw new HttpRequestException("Google sent an empty token response.");
    }

    /// <summary>
    /// The account's address from the ID token. The token came straight from Google's token
    /// endpoint over HTTPS, so its signature need not be checked
    /// (https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation).
    /// </summary>
    private static string EmailIn(string? idToken)
    {
        var parts = idToken?.Split('.');
        if (parts is not { Length: 3 })
        {
            throw new HttpRequestException("Google sent no ID token; ask for the openid and email scopes.");
        }

        var payload = parts[1].Replace('-', '+').Replace('_', '/');
        payload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
        using var claims = JsonDocument.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(payload)));
        return claims.RootElement.TryGetProperty("email", out var email) && email.GetString() is { Length: > 0 } address
            ? address
            : throw new HttpRequestException("Google's ID token has no email.");
    }

    private sealed record TokenResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("refresh_token")] string? RefreshToken,
        [property: JsonPropertyName("id_token")] string? IdToken,
        [property: JsonPropertyName("scope")] string? Scope);

    private sealed record TokenError([property: JsonPropertyName("error")] string? Error);

    private sealed record CalendarListPage(
        [property: JsonPropertyName("items")] List<CalendarListItem>? Items,
        [property: JsonPropertyName("nextPageToken")] string? NextPageToken);

    private sealed record CalendarListItem(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("summary")] string? Summary,
        [property: JsonPropertyName("summaryOverride")] string? SummaryOverride,
        [property: JsonPropertyName("backgroundColor")] string? BackgroundColor,
        [property: JsonPropertyName("accessRole")] string? AccessRole,
        [property: JsonPropertyName("primary")] bool Primary);

    private sealed record EventsPage(
        [property: JsonPropertyName("items")] List<EventItem>? Items,
        [property: JsonPropertyName("nextPageToken")] string? NextPageToken,
        [property: JsonPropertyName("nextSyncToken")] string? NextSyncToken);

    private sealed record EventItem(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("etag")] string? ETag,
        [property: JsonPropertyName("status")] string? Status,
        [property: JsonPropertyName("summary")] string? Summary,
        [property: JsonPropertyName("location")] string? Location,
        [property: JsonPropertyName("recurringEventId")] string? RecurringEventId,
        [property: JsonPropertyName("start")] EventTime? Start,
        [property: JsonPropertyName("end")] EventTime? End,
        [property: JsonPropertyName("description")] string? Description = null,
        [property: JsonPropertyName("recurrence")] List<string>? Recurrence = null);

    private sealed record EventTime(
        [property: JsonPropertyName("date")] string? Date,
        [property: JsonPropertyName("dateTime")] DateTimeOffset? DateTime);
}
