using System.Security.Cryptography;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Calendar;

/// <summary>
/// Adding, changing and deleting events from the wall or a phone. Google Calendar stays the
/// source of truth: each change is written to Google first, with the cached version's etag so a
/// change made elsewhere in the meantime is never overwritten, and the cache then takes what
/// Google stored. The demo never calls Google, so its changes go straight to the visitor's copy.
/// </summary>
/// <remarks>
/// Anyone signed in to the family may do this, a paired wall included: the plan has events
/// added from the wall, and kids have no sign-in of their own. A change or delete with
/// <c>?series=true</c> applies to every event of a repeating series (<see cref="EventSeries"/>).
/// </remarks>
public static class EventEndpoints
{
    public const int MaxTitle = 255;

    public const int MaxLocation = 255;

    public static IEndpointRouteBuilder MapCalendarEvents(this IEndpointRouteBuilder app)
    {
        var events = app.MapGroup("/api/calendar/events").RequireAuthorization(Policies.Family);
        events.MapPost("", Add);
        events.MapPut("{id:guid}", Change);
        events.MapDelete("{id:guid}", Delete);

        return app;
    }

    /// <summary>Adds an event, or a series of them. A series answers with its first event.</summary>
    private static async Task<Results<Created<EventResponse>, ValidationProblem, ProblemHttpResult, NotFound>> Add(
        EventRequest request,
        WheelhouseDbContext db,
        ICurrentFamily family,
        GoogleTokens tokens,
        IGoogleCalendar google,
        CalendarSync sync,
        CalendarSyncTrigger syncSoon,
        TimeProvider time,
        IOptions<InstanceOptions> instance,
        ILogger<GoogleConnection> logger,
        CancellationToken cancellationToken)
    {
        if (family.Id is not { } familyId)
        {
            return TypedResults.NotFound();
        }

        var (draft, errors) = await DraftAsync(request, db, cancellationToken);
        var source = await db.CalendarSources.SingleOrDefaultAsync(s => s.Id == request.CalendarId, cancellationToken);
        errors ??= WritableErrors(source);
        if (errors is not null)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var creationId = request.CreationId is { } key ? EventIdentity.ForCreation(familyId, key) : null;
        // Serialize retries across API processes. The transaction also keeps revision and cache
        // changes atomic; Google enforces the same stable id if a cancellation rolled this back.
        await using var creationTransaction = creationId is not null
            ? await db.Database.BeginTransactionAsync(cancellationToken) : null;
        if (creationId is not null)
        {
            var lockKey = BitConverter.ToInt64(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(creationId)));
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({lockKey})", cancellationToken);
            var existing = await db.EventInstances
                .Where(e => e.GoogleEventId == creationId || e.RecurringEventId == creationId)
                .OrderBy(e => e.StartDate).ThenBy(e => e.StartsAt).FirstOrDefaultAsync(cancellationToken);
            if (existing is not null)
            {
                var originalSource = await db.CalendarSources.SingleAsync(s => s.Id == existing.CalendarSourceId, cancellationToken);
                await creationTransaction!.CommitAsync(cancellationToken);
                return TypedResults.Created($"/api/calendar/events/{existing.Id}", EventResponse.From(existing, originalSource));
            }
        }

        draft = draft! with { Recurrence = EventSeries.RuleFor(request.Repeat), Id = creationId };
        EventInstance RowFor(GoogleEvent stored)
        {
            var row = new EventInstance
            {
                Id = Guid.CreateVersion7(),
                FamilyId = familyId,
                CalendarSourceId = source!.Id,
                GoogleEventId = stored.Id,
                Title = "",
            };
            CalendarSync.CopyTo(row, stored);
            db.EventInstances.Add(row);
            return row;
        }

        if (IsDemo(instance))
        {
            var id = creationId ?? Guid.NewGuid().ToString("N");
            var zone = Zone(draft);
            var first = draft.Recurrence is null
                ? RowFor(new GoogleEvent(id, null, draft.Title, draft.Location, draft.StartsAt, draft.EndsAt, draft.StartDate, draft.EndDate))
                : EventSeries.Occurrences(draft, request.Repeat, id, Today(time, zone).AddDays(CalendarSync.Ahead.Days), zone)
                    .Select(RowFor)
                    .ToList()[0];
            await db.SaveChangesAsync(cancellationToken);
            if (creationTransaction is not null) await creationTransaction.CommitAsync(cancellationToken);
            return TypedResults.Created($"/api/calendar/events/{first.Id}", EventResponse.From(first, source!));
        }

        var write = await GoogleWrite.StartAsync(db, tokens, google, logger, cancellationToken);
        if (write.Problem is { } problem)
        {
            if (creationTransaction is not null) await creationTransaction.CommitAsync(cancellationToken);
            return problem;
        }

        GoogleEvent stored;
        try
        {
            stored = await google.InsertEventAsync(write.AccessToken!, source!.GoogleCalendarId, draft, cancellationToken);
        }
        catch (Exception exception) when (GoogleWrite.IsProblem(exception))
        {
            var refusal = await write.ProblemFor(exception, source!, cancellationToken);
            if (creationTransaction is not null) await creationTransaction.CommitAsync(cancellationToken);
            return refusal;
        }

        if (draft.Recurrence is null)
        {
            var row = RowFor(stored);
            await db.SaveChangesAsync(cancellationToken);
            if (creationTransaction is not null) await creationTransaction.CommitAsync(cancellationToken);
            return TypedResults.Created($"/api/calendar/events/{row.Id}", EventResponse.From(row, source));
        }

        // Google expands the series; reading the calendar again brings in its occurrences.
        try
        {
            await sync.ListAsync(source, write.AccessToken!, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception exception) when (GoogleWrite.IsProblem(exception))
        {
            logger.LogWarning(exception, "Google could not be reached to read a new series; the next sync brings it in.");
            syncSoon.SyncSoon(familyId);
        }

        var firstOccurrence = await db.EventInstances
            .Where(e => e.CalendarSourceId == source.Id && e.RecurringEventId == stored.Id)
            .OrderBy(e => e.StartDate).ThenBy(e => e.StartsAt)
            .FirstOrDefaultAsync(cancellationToken);
        if (firstOccurrence is null)
        {
            // Until the next sync replaces it, the series shows as its first event.
            firstOccurrence = RowFor(stored with { RecurringEventId = stored.Id });
            await db.SaveChangesAsync(cancellationToken);
        }

        if (creationTransaction is not null) await creationTransaction.CommitAsync(cancellationToken);
        return TypedResults.Created($"/api/calendar/events/{firstOccurrence.Id}", EventResponse.From(firstOccurrence, source));
    }

    /// <summary>
    /// Changes an event, or one occurrence of a repeating one, or with <paramref name="series"/>
    /// every event of its series. A different calendar moves it, which Google allows only for a
    /// whole event or series, so an occurrence on its own stays in its calendar. Answers 409 with
    /// the event as Google has it now when it changed there first.
    /// </summary>
    private static async Task<Results<Ok<EventResponse>, Conflict<EventResponse>, ValidationProblem, ProblemHttpResult, NotFound>> Change(
        Guid id,
        EventRequest request,
        WheelhouseDbContext db,
        GoogleTokens tokens,
        IGoogleCalendar google,
        CalendarSync sync,
        CalendarSyncTrigger syncSoon,
        IOptions<InstanceOptions> instance,
        ILogger<GoogleConnection> logger,
        CancellationToken cancellationToken,
        bool series = false)
    {
        var row = await db.EventInstances.SingleOrDefaultAsync(e => e.Id == id, cancellationToken);
        if (row is null)
        {
            return TypedResults.NotFound();
        }

        series &= row.RecurringEventId is not null;
        var (draft, errors) = await DraftAsync(request, db, cancellationToken);
        var sources = await db.CalendarSources
            .Where(s => s.Id == row.CalendarSourceId || s.Id == request.CalendarId)
            .ToDictionaryAsync(s => s.Id, cancellationToken);
        var from = sources[row.CalendarSourceId];
        var to = sources.GetValueOrDefault(request.CalendarId);
        errors ??= WritableErrors(from) ?? WritableErrors(to);
        if (errors is null && series)
        {
            errors = EventSeries.Errors(row, request, Zone(draft!));
        }
        else if (errors is null && from != to && row.RecurringEventId is not null)
        {
            errors = new() { ["calendarId"] = ["One event of a series stays in the series' calendar. Change all events to move them."] };
        }

        if (errors is not null)
        {
            return TypedResults.ValidationProblem(errors);
        }

        if (IsDemo(instance))
        {
            if (series)
            {
                EventSeries.Apply(await SeriesOf(row, db, cancellationToken), draft!, Zone(draft!));
                await MoveSeriesAsync(row, to!, db, cancellationToken);
            }
            else
            {
                CalendarSync.CopyTo(row, new GoogleEvent(row.GoogleEventId, row.RecurringEventId, draft!.Title, draft.Location,
                    draft.StartsAt, draft.EndsAt, draft.StartDate, draft.EndDate));
                row.CalendarSourceId = to!.Id;
            }

            await db.SaveChangesAsync(cancellationToken);
            return TypedResults.Ok(EventResponse.From(row, to!));
        }

        var write = await GoogleWrite.StartAsync(db, tokens, google, logger, cancellationToken);
        if (write.Problem is { } problem)
        {
            return problem;
        }

        try
        {
            if (series)
            {
                // The series is changed through its first event, so the occurrence on screen is checked by hand.
                var current = await google.GetEventAsync(write.AccessToken!, from.GoogleCalendarId, row.GoogleEventId, cancellationToken);
                var master = await google.GetEventAsync(write.AccessToken!, from.GoogleCalendarId, row.RecurringEventId!, cancellationToken);
                if (current?.ETag != row.ETag || master is null)
                {
                    return await write.ShowAsync(row, from, master is null ? null : current, cancellationToken) is { } shown
                        ? TypedResults.Conflict(shown)
                        : TypedResults.NotFound();
                }

                await google.PatchEventAsync(write.AccessToken!, from.GoogleCalendarId, master.Id, master.ETag,
                    EventSeries.MasterDraft(master, draft!, Zone(draft!)), cancellationToken);
                if (from != to)
                {
                    await google.MoveEventAsync(write.AccessToken!, from.GoogleCalendarId, master.Id, to!.GoogleCalendarId, cancellationToken);
                }
            }
            else
            {
                var stored = await google.PatchEventAsync(write.AccessToken!, from.GoogleCalendarId, row.GoogleEventId, row.ETag, draft!, cancellationToken);
                if (from != to)
                {
                    stored = await google.MoveEventAsync(write.AccessToken!, from.GoogleCalendarId, row.GoogleEventId, to!.GoogleCalendarId, cancellationToken);
                }

                CalendarSync.CopyTo(row, stored);
                row.CalendarSourceId = to!.Id;
                await db.SaveChangesAsync(cancellationToken);
                return TypedResults.Ok(EventResponse.From(row, to));
            }
        }
        catch (GoogleEventChangedException)
        {
            return await write.RefreshAsync(row, from, cancellationToken) is { } current
                ? TypedResults.Conflict(current)
                : TypedResults.NotFound();
        }
        catch (GoogleEventGoneException)
        {
            db.EventInstances.Remove(row);
            await db.SaveChangesAsync(cancellationToken);
            return TypedResults.NotFound();
        }
        catch (Exception exception) when (GoogleWrite.IsProblem(exception))
        {
            return await write.ProblemFor(exception, from, cancellationToken);
        }

        // Google gives every occurrence a new version, and new ids when the times changed, so the
        // calendars are read again. The answer is the occurrence on the day that was on screen.
        var zone = Zone(draft!);
        var (seriesId, day) = (row.RecurringEventId!, EventSeries.DayOf(row, zone));
        try
        {
            await sync.ListAsync(from, write.AccessToken!, cancellationToken);
            if (from != to)
            {
                await sync.ListAsync(to!, write.AccessToken!, cancellationToken);
            }

            await db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception exception) when (GoogleWrite.IsProblem(exception))
        {
            logger.LogWarning(exception, "Google could not be reached to read a changed series; the next sync brings it in.");
            syncSoon.SyncSoon(row.FamilyId);
            db.ChangeTracker.Clear();
            row = await db.EventInstances.SingleAsync(e => e.Id == id, cancellationToken);
            EventSeries.Apply(await SeriesOf(row, db, cancellationToken), draft!, zone);
            await MoveSeriesAsync(row, to!, db, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
        }

        var occurrences = await db.EventInstances
            .Where(e => e.CalendarSourceId == to!.Id && e.RecurringEventId == seriesId)
            .OrderBy(e => e.StartDate).ThenBy(e => e.StartsAt)
            .ToListAsync(cancellationToken);
        var answer = occurrences.FirstOrDefault(e => EventSeries.DayOf(e, zone) == day) ?? occurrences.FirstOrDefault();
        return answer is null ? TypedResults.NotFound() : TypedResults.Ok(EventResponse.From(answer, to!));
    }

    /// <summary>
    /// Deletes an event, or one occurrence of a repeating one, or with <paramref name="series"/>
    /// the whole series. Answers 409 with the event as Google has it now when it changed there
    /// first, so nobody deletes a change they never saw.
    /// </summary>
    private static async Task<Results<NoContent, Conflict<EventResponse>, ValidationProblem, ProblemHttpResult, NotFound>> Delete(
        Guid id,
        WheelhouseDbContext db,
        GoogleTokens tokens,
        IGoogleCalendar google,
        IOptions<InstanceOptions> instance,
        ILogger<GoogleConnection> logger,
        CancellationToken cancellationToken,
        bool series = false)
    {
        var row = await db.EventInstances.SingleOrDefaultAsync(e => e.Id == id, cancellationToken);
        if (row is null)
        {
            return TypedResults.NotFound();
        }

        series &= row.RecurringEventId is not null;
        var source = await db.CalendarSources.SingleAsync(s => s.Id == row.CalendarSourceId, cancellationToken);
        if (WritableErrors(source) is { } errors)
        {
            return TypedResults.ValidationProblem(errors);
        }

        if (!IsDemo(instance))
        {
            var write = await GoogleWrite.StartAsync(db, tokens, google, logger, cancellationToken);
            if (write.Problem is { } problem)
            {
                return problem;
            }

            try
            {
                if (series)
                {
                    var current = await google.GetEventAsync(write.AccessToken!, source.GoogleCalendarId, row.GoogleEventId, cancellationToken);
                    if (current is not null && current.ETag != row.ETag)
                    {
                        return TypedResults.Conflict((await write.ShowAsync(row, source, current, cancellationToken))!);
                    }

                    await google.DeleteEventAsync(write.AccessToken!, source.GoogleCalendarId, row.RecurringEventId!, etag: null, cancellationToken);
                }
                else
                {
                    await google.DeleteEventAsync(write.AccessToken!, source.GoogleCalendarId, row.GoogleEventId, row.ETag, cancellationToken);
                }
            }
            catch (GoogleEventChangedException)
            {
                return await write.RefreshAsync(row, source, cancellationToken) is { } current
                    ? TypedResults.Conflict(current)
                    : TypedResults.NoContent();
            }
            catch (Exception exception) when (GoogleWrite.IsProblem(exception))
            {
                return await write.ProblemFor(exception, source, cancellationToken);
            }
        }

        db.EventInstances.RemoveRange(series ? await SeriesOf(row, db, cancellationToken) : [row]);
        await db.SaveChangesAsync(cancellationToken);

        return TypedResults.NoContent();
    }

    /// <summary>The cached occurrences of <paramref name="row"/>'s series in its calendar, itself included.</summary>
    private static Task<List<EventInstance>> SeriesOf(EventInstance row, WheelhouseDbContext db, CancellationToken cancellationToken) =>
        db.EventInstances
            .Where(e => e.CalendarSourceId == row.CalendarSourceId && e.RecurringEventId == row.RecurringEventId)
            .ToListAsync(cancellationToken);

    private static async Task MoveSeriesAsync(EventInstance row, CalendarSource to, WheelhouseDbContext db, CancellationToken cancellationToken)
    {
        foreach (var occurrence in await SeriesOf(row, db, cancellationToken))
        {
            occurrence.CalendarSourceId = to.Id;
        }
    }

    private static TimeZoneInfo Zone(GoogleEventDraft draft) => TimeZoneInfo.FindSystemTimeZoneById(draft.TimeZone);

    private static DateOnly Today(TimeProvider time, TimeZoneInfo zone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(time.GetUtcNow(), zone).DateTime);

    private static bool IsDemo(IOptions<InstanceOptions> instance) => instance.Value.Mode == InstanceMode.Demo;

    /// <summary>The event as Google is to store it, in the family's time zone, or what is wrong with the request.</summary>
    private static async Task<(GoogleEventDraft? Draft, Dictionary<string, string[]>? Errors)> DraftAsync(
        EventRequest request, WheelhouseDbContext db, CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>();
        var title = request.Title?.Trim() ?? "";
        if (title.Length == 0)
        {
            errors["title"] = ["Give the event a title."];
        }
        else if (title.Length > MaxTitle)
        {
            errors["title"] = [$"Keep the title to {MaxTitle} characters."];
        }

        var location = string.IsNullOrWhiteSpace(request.Location) ? null : request.Location.Trim();
        if (location is { Length: > MaxLocation })
        {
            errors["location"] = [$"Keep the location to {MaxLocation} characters."];
        }

        var timeZone = await db.Families.Select(f => f.TimeZone).SingleAsync(cancellationToken);
        GoogleEventDraft? draft = null;
        if (request.AllDay)
        {
            if (request.EndDate <= request.StartDate)
            {
                errors["endDate"] = ["End the event on or after the day it starts."];
            }
            else
            {
                draft = new GoogleEventDraft(title, location, null, null, request.StartDate, request.EndDate, timeZone);
            }
        }
        else if (request.StartTime is not { } startTime || request.EndTime is not { } endTime)
        {
            errors["startTime"] = ["Give the event a start and an end time, or make it all day."];
        }
        else
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
            var startsAt = CalendarEndpoints.At(request.StartDate, startTime, zone);
            var endsAt = CalendarEndpoints.At(request.EndDate, endTime, zone);
            if (endsAt <= startsAt)
            {
                errors["endTime"] = ["End the event after it starts."];
            }
            else
            {
                draft = new GoogleEventDraft(title, location, startsAt, endsAt, null, null, timeZone);
            }
        }

        return errors.Count == 0 ? (draft, null) : (null, errors);
    }

    /// <summary>Null when events can be added to and changed in the calendar.</summary>
    private static Dictionary<string, string[]>? WritableErrors(CalendarSource? source) => source switch
    {
        null => new() { ["calendarId"] = ["Choose one of the family's calendars."] },
        { CanWrite: false } => new() { ["calendarId"] = [$"The family's Google account can't change events in {source.Name}."] },
        _ => null,
    };

    /// <summary>One change on a family instance: an access token for the shared account, and what to answer when Google refuses.</summary>
    private sealed class GoogleWrite
    {
        private WheelhouseDbContext _db = null!;
        private IGoogleCalendar _google = null!;
        private ILogger _logger = null!;

        public string? AccessToken { get; private init; }

        public ProblemHttpResult? Problem { get; private init; }

        public static async Task<GoogleWrite> StartAsync(
            WheelhouseDbContext db, GoogleTokens tokens, IGoogleCalendar google, ILogger logger, CancellationToken cancellationToken)
        {
            var connection = await db.GoogleConnections.SingleOrDefaultAsync(cancellationToken);
            if (connection is not { Status: GoogleConnectionStatus.Connected })
            {
                return new GoogleWrite { Problem = ReconnectProblem() };
            }

            try
            {
                var accessToken = await google.AccessTokenAsync(tokens.Unprotect(connection.EncryptedRefreshToken), cancellationToken);
                return new GoogleWrite { AccessToken = accessToken, _db = db, _google = google, _logger = logger };
            }
            catch (Exception exception) when (exception is GoogleGrantRevokedException or CryptographicException)
            {
                connection.Status = GoogleConnectionStatus.NeedsReauth;
                await db.SaveChangesAsync(cancellationToken);
                return new GoogleWrite { Problem = ReconnectProblem() };
            }
            catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
            {
                logger.LogWarning(exception, "Google could not be reached for an access token.");
                return new GoogleWrite { Problem = UnreachableProblem() };
            }
        }

        /// <summary>The failures that become a problem for the screen rather than a server error.</summary>
        public static bool IsProblem(Exception exception) =>
            exception is GoogleCalendarGoneException or HttpRequestException or TaskCanceledException;

        public async Task<ProblemHttpResult> ProblemFor(Exception exception, CalendarSource source, CancellationToken cancellationToken)
        {
            if (exception is GoogleCalendarGoneException)
            {
                // The calendar was unshared or made read-only; it stops being offered until a parent chooses it again.
                source.CanWrite = false;
                await _db.SaveChangesAsync(cancellationToken);
                return TypedResults.Problem(
                    title: $"Google no longer lets the family's account change events in {source.Name}.",
                    statusCode: StatusCodes.Status409Conflict);
            }

            _logger.LogWarning(exception, "Google could not be reached to change an event.");
            return UnreachableProblem();
        }

        /// <summary>
        /// Brings a row that changed in Google up to date and returns it, or removes it and
        /// returns null when it was deleted there.
        /// </summary>
        public async Task<EventResponse?> RefreshAsync(EventInstance row, CalendarSource source, CancellationToken cancellationToken) =>
            await ShowAsync(row, source, await _google.GetEventAsync(AccessToken!, source.GoogleCalendarId, row.GoogleEventId, cancellationToken), cancellationToken);

        /// <summary>Like <see cref="RefreshAsync"/>, with the row as Google has it now already read.</summary>
        public async Task<EventResponse?> ShowAsync(EventInstance row, CalendarSource source, GoogleEvent? current, CancellationToken cancellationToken)
        {
            if (current is null)
            {
                _db.EventInstances.Remove(row);
            }
            else
            {
                CalendarSync.CopyTo(row, current);
            }

            await _db.SaveChangesAsync(cancellationToken);
            return current is null ? null : EventResponse.From(row, source);
        }

        private static ProblemHttpResult ReconnectProblem() => TypedResults.Problem(
            title: "Google no longer accepts the connection. A parent can connect the family's Google account again in Settings.",
            statusCode: StatusCodes.Status409Conflict);

        private static ProblemHttpResult UnreachableProblem() => TypedResults.Problem(
            title: "Google could not be reached. Try again in a moment.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
}
