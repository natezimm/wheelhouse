using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Calendar;

/// <summary>
/// Connecting the family's shared Google account, and choosing which of its calendars the family
/// shows and whose each one is. Everything here is a parent's.
/// </summary>
public static class GoogleConnectionEndpoints
{
    public const string CalendarScope = "https://www.googleapis.com/auth/calendar";

    /// <summary>Calendar access, plus the account's address so the parents can see which one is connected.</summary>
    public const string Scopes = $"openid email {CalendarScope}";

    public const string CallbackPath = "/api/calendar/google/callback";

    public static IServiceCollection AddGoogleCalendar(this IServiceCollection services)
    {
        services.AddScoped<GoogleTokens>();
        services.AddHttpClient<IGoogleCalendar, GoogleCalendarApi>(client => client.Timeout = TimeSpan.FromSeconds(20));
        return services;
    }

    public static IEndpointRouteBuilder MapGoogleConnection(this IEndpointRouteBuilder app)
    {
        var google = app.MapGroup("/api/calendar/google").RequireAuthorization(Policies.Parent);
        google.MapGet("", GetConnection);
        google.MapGet("connect", Connect);
        google.MapGet("callback", Callback);
        google.MapDelete("", Disconnect);

        var sources = app.MapGroup("/api/calendar/sources").RequireAuthorization(Policies.Parent);
        sources.MapGet("", GetChoices);
        sources.MapPut("", SaveChoices);

        return app;
    }

    /// <summary>Only a family instance with a Google client can connect; the demo never calls Google.</summary>
    private static bool CanConnect(IOptions<InstanceOptions> instance, IOptions<GoogleSignInOptions> client) =>
        instance.Value.Mode == InstanceMode.Family && client.Value.IsConfigured;

    private static async Task<Ok<GoogleConnectionResponse>> GetConnection(
        WheelhouseDbContext db,
        IOptions<InstanceOptions> instance,
        IOptions<GoogleSignInOptions> client,
        CancellationToken cancellationToken)
    {
        var connection = await db.GoogleConnections.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        return TypedResults.Ok(new GoogleConnectionResponse(CanConnect(instance, client), connection?.Email, connection?.Status));
    }

    /// <summary>
    /// The phone's "Connect Google" link. It sends the browser to Google's consent screen for
    /// Calendar with offline access, which comes back to <see cref="Callback"/>.
    /// </summary>
    private static Results<RedirectHttpResult, NotFound> Connect(
        HttpRequest request,
        ICurrentFamily family,
        GoogleTokens tokens,
        IOptions<InstanceOptions> instance,
        IOptions<GoogleSignInOptions> client)
    {
        if (!CanConnect(instance, client) || family.Id is not { } familyId)
        {
            return TypedResults.NotFound();
        }

        var query = QueryString.Create(new Dictionary<string, string?>
        {
            ["client_id"] = client.Value.ClientId,
            ["redirect_uri"] = RedirectUri(request),
            ["response_type"] = "code",
            ["scope"] = Scopes,
            // A refresh token, so the API can read the calendars with nobody signed in.
            ["access_type"] = "offline",
            // Google sends a refresh token only when the consent screen is shown.
            ["prompt"] = "consent select_account",
            ["state"] = tokens.ConsentState(familyId),
        });

        return TypedResults.Redirect($"https://accounts.google.com/o/oauth2/v2/auth{query}");
    }

    /// <summary>
    /// Where Google's consent screen returns. The code becomes a refresh token, stored encrypted
    /// for the family, and the parent goes on to choose calendars. Anything else sends them back
    /// to Settings, which says what happened.
    /// </summary>
    private static async Task<Results<RedirectHttpResult, NotFound>> Callback(
        string? code,
        string? state,
        string? error,
        HttpRequest request,
        WheelhouseDbContext db,
        ICurrentFamily family,
        GoogleTokens tokens,
        IGoogleCalendar google,
        IOptions<InstanceOptions> instance,
        IOptions<GoogleSignInOptions> client,
        TimeProvider time,
        ILogger<GoogleConnection> logger,
        CancellationToken cancellationToken)
    {
        if (!CanConnect(instance, client) || family.Id is not { } familyId)
        {
            return TypedResults.NotFound();
        }

        if (error is not null)
        {
            return TypedResults.Redirect("/settings?google=cancelled");
        }

        if (code is null || state is null || !tokens.IsConsentStateFor(state, familyId))
        {
            return TypedResults.Redirect("/settings?google=failed");
        }

        GoogleGrant grant;
        try
        {
            grant = await google.ExchangeCodeAsync(code, RedirectUri(request), cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or GoogleGrantRevokedException)
        {
            logger.LogWarning(exception, "Google did not accept the code from its consent screen.");
            return TypedResults.Redirect("/settings?google=failed");
        }

        // Google's consent screen lets the account untick Calendar access.
        if (grant.RefreshToken is null || !grant.Scopes.Split(' ').Contains(CalendarScope))
        {
            return TypedResults.Redirect("/settings?google=no-calendar");
        }

        var connection = await db.GoogleConnections.SingleOrDefaultAsync(cancellationToken);
        if (connection is null)
        {
            connection = new GoogleConnection
            {
                Id = Guid.CreateVersion7(),
                FamilyId = familyId,
                Email = grant.Email,
                EncryptedRefreshToken = "",
                Scopes = "",
            };
            db.GoogleConnections.Add(connection);
        }
        else if (!string.Equals(connection.Email, grant.Email, StringComparison.OrdinalIgnoreCase))
        {
            // Another account's calendars mean nothing to this one.
            await db.CalendarSources.ExecuteDeleteAsync(cancellationToken);
        }

        connection.Email = grant.Email;
        connection.EncryptedRefreshToken = tokens.Protect(grant.RefreshToken);
        connection.Scopes = grant.Scopes;
        connection.Status = GoogleConnectionStatus.Connected;
        connection.ConnectedAt = time.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);

        return TypedResults.Redirect("/settings/calendars");
    }

    /// <summary>
    /// Forgets the shared account: Google is told to drop the grant, and the family's calendars
    /// and their events are removed. Their originals in Google are untouched.
    /// </summary>
    private static async Task<Results<NoContent, NotFound>> Disconnect(
        WheelhouseDbContext db,
        GoogleTokens tokens,
        IGoogleCalendar google,
        ILogger<GoogleConnection> logger,
        CancellationToken cancellationToken)
    {
        var connection = await db.GoogleConnections.SingleOrDefaultAsync(cancellationToken);
        if (connection is null)
        {
            return TypedResults.NotFound();
        }

        try
        {
            await google.RevokeAsync(tokens.Unprotect(connection.EncryptedRefreshToken), cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or System.Security.Cryptography.CryptographicException)
        {
            // Disconnecting still forgets the token here; the account can remove the app in Google too.
            logger.LogWarning(exception, "Google could not be told to drop the family's connection.");
        }

        await db.CalendarSources.ExecuteDeleteAsync(cancellationToken);
        db.GoogleConnections.Remove(connection);
        await db.SaveChangesAsync(cancellationToken);

        return TypedResults.NoContent();
    }

    /// <summary>
    /// The calendars a parent can choose from, and which are shown and whose each is. With a
    /// Google connection they are the shared account's calendar list; without one (the demo) they
    /// are the calendars the family already has.
    /// </summary>
    private static async Task<Results<Ok<CalendarChoicesResponse>, ProblemHttpResult>> GetChoices(
        WheelhouseDbContext db,
        GoogleTokens tokens,
        IGoogleCalendar google,
        ILogger<GoogleConnection> logger,
        CancellationToken cancellationToken)
    {
        var available = await AvailableAsync(db, tokens, google, logger, cancellationToken);
        if (available.Problem is { } problem)
        {
            return problem;
        }

        var shown = await db.CalendarSources.AsNoTracking().ToDictionaryAsync(s => s.GoogleCalendarId, cancellationToken);
        var choices = available.Calendars!
            .Select(calendar => new CalendarChoice(
                calendar.Id,
                calendar.Name,
                calendar.Color,
                shown.ContainsKey(calendar.Id),
                shown.GetValueOrDefault(calendar.Id)?.MemberId))
            .ToList();

        return TypedResults.Ok(new CalendarChoicesResponse(choices));
    }

    /// <summary>
    /// Shows exactly the calendars named, each as the member's or, with no member, the whole
    /// family's. A calendar left out is removed with its events.
    /// </summary>
    private static async Task<Results<Ok<CalendarChoicesResponse>, ValidationProblem, ProblemHttpResult, NotFound>> SaveChoices(
        CalendarChoicesRequest request,
        WheelhouseDbContext db,
        ICurrentFamily family,
        GoogleTokens tokens,
        IGoogleCalendar google,
        ILogger<GoogleConnection> logger,
        CancellationToken cancellationToken)
    {
        if (family.Id is not { } familyId)
        {
            return TypedResults.NotFound();
        }

        var chosen = request.Calendars ?? [];
        if (chosen.Select(c => c.GoogleCalendarId).Distinct().Count() != chosen.Count)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["calendars"] = ["Choose each calendar once."] });
        }

        var memberIds = await db.Members.Select(m => m.Id).ToListAsync(cancellationToken);
        if (chosen.Any(c => c.MemberId is { } id && !memberIds.Contains(id)))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["memberId"] = ["Choose someone in the family."] });
        }

        var available = await AvailableAsync(db, tokens, google, logger, cancellationToken);
        if (available.Problem is { } problem)
        {
            return problem;
        }

        var names = available.Calendars!.ToDictionary(c => c.Id, c => c.Name);
        if (chosen.Any(c => !names.ContainsKey(c.GoogleCalendarId)))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["calendars"] = ["Choose from the account's calendars."] });
        }

        var sources = await db.CalendarSources.ToListAsync(cancellationToken);
        var wanted = chosen.ToDictionary(c => c.GoogleCalendarId);
        db.CalendarSources.RemoveRange(sources.Where(s => !wanted.ContainsKey(s.GoogleCalendarId)));
        foreach (var choice in chosen)
        {
            var source = sources.SingleOrDefault(s => s.GoogleCalendarId == choice.GoogleCalendarId);
            if (source is null)
            {
                // Its events arrive with the next sync.
                source = new CalendarSource { Id = Guid.CreateVersion7(), FamilyId = familyId, GoogleCalendarId = choice.GoogleCalendarId, Name = "" };
                db.CalendarSources.Add(source);
            }

            source.Name = names[choice.GoogleCalendarId];
            source.MemberId = choice.MemberId;
        }

        await db.SaveChangesAsync(cancellationToken);

        return TypedResults.Ok(new CalendarChoicesResponse(available.Calendars!
            .Select(c => new CalendarChoice(c.Id, c.Name, c.Color, wanted.ContainsKey(c.Id), wanted.GetValueOrDefault(c.Id)?.MemberId))
            .ToList()));
    }

    /// <summary>The calendars there are to choose from, or the problem that stops a parent choosing.</summary>
    private static async Task<(IReadOnlyList<GoogleCalendarEntry>? Calendars, ProblemHttpResult? Problem)> AvailableAsync(
        WheelhouseDbContext db,
        GoogleTokens tokens,
        IGoogleCalendar google,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var connection = await db.GoogleConnections.SingleOrDefaultAsync(cancellationToken);
        if (connection is null)
        {
            var existing = await db.CalendarSources.AsNoTracking().OrderBy(s => s.Name).ToListAsync(cancellationToken);
            return ([.. existing.Select(s => new GoogleCalendarEntry(s.GoogleCalendarId, s.Name, null, CanWrite: false, Primary: false))], null);
        }

        if (connection.Status == GoogleConnectionStatus.NeedsReauth)
        {
            return (null, ReconnectProblem());
        }

        try
        {
            var calendars = await google.ListCalendarsAsync(tokens.Unprotect(connection.EncryptedRefreshToken), cancellationToken);
            // The account's own calendar first, then by name.
            return ([.. calendars.OrderByDescending(c => c.Primary).ThenBy(c => c.Name, StringComparer.CurrentCultureIgnoreCase)], null);
        }
        catch (GoogleGrantRevokedException)
        {
            connection.Status = GoogleConnectionStatus.NeedsReauth;
            await db.SaveChangesAsync(cancellationToken);
            return (null, ReconnectProblem());
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(exception, "Google's calendar list could not be read.");
            return (null, TypedResults.Problem(
                title: "Google could not be reached. Try again in a moment.",
                statusCode: StatusCodes.Status503ServiceUnavailable));
        }
    }

    private static ProblemHttpResult ReconnectProblem() => TypedResults.Problem(
        title: "Google no longer accepts the connection. Connect the family's Google account again.",
        statusCode: StatusCodes.Status409Conflict);

    /// <summary>
    /// Google's consent screen returns here. The scheme comes from the server's nginx, so on a
    /// deployed instance it is https; the address must be one of the OAuth client's redirect URIs.
    /// </summary>
    private static string RedirectUri(HttpRequest request) => $"{request.Scheme}://{request.Host}{CallbackPath}";
}

/// <summary>Whether this instance can connect Google at all, and the account connected, if any.</summary>
public sealed record GoogleConnectionResponse(bool CanConnect, string? Email, GoogleConnectionStatus? Status);

public sealed record CalendarChoice(string GoogleCalendarId, string Name, string? Color, bool Shown, Guid? MemberId);

public sealed record CalendarChoicesResponse(IReadOnlyList<CalendarChoice> Calendars);

public sealed record CalendarChoiceRequest(string GoogleCalendarId, Guid? MemberId);

public sealed record CalendarChoicesRequest(IReadOnlyList<CalendarChoiceRequest>? Calendars);
