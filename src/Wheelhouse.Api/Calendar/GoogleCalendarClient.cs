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
}

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

    private async Task<string> AccessTokenAsync(string refreshToken, CancellationToken cancellationToken)
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
}
