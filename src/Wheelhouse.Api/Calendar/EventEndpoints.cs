using System.Security.Claims;
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
/// <c>?series=true</c> applies to every event of a repeating series (<see cref="EventSeries"/>),
/// and <c>?following=true</c> to an event and every later one, which then become a series of their own.
/// </remarks>
public static class EventEndpoints
{
    public const int MaxTitle = 255;

    public const int MaxLocation = 255;

    /// <summary>The longest notes a screen may write; Google's own limit is far higher.</summary>
    public const int MaxDescription = EventInstance.MaxDescription;

    /// <summary>The longest an event may run, in days: about five years, which catches a mistyped year.</summary>
    public const int MaxDays = 5 * 366;

    public static IEndpointRouteBuilder MapCalendarEvents(this IEndpointRouteBuilder app)
    {
        var events = app.MapGroup("/api/calendar/events").RequireAuthorization(Policies.Family);
        // Whatever event an answer carries, a conflict's included, a display sees a private one only as busy.
        events.AddEndpointFilter(async (context, next) =>
        {
            var result = await next(context);
            if (!context.HttpContext.User.IsDisplay())
            {
                return result;
            }

            return (result is INestedHttpResult nested ? nested.Result : result) switch
            {
                Ok<EventResponse> { Value: { } shown } => TypedResults.Ok(shown.For(display: true)),
                Created<EventResponse> { Value: { } shown } created => TypedResults.Created(created.Location, shown.For(display: true)),
                Conflict<EventResponse> { Value: { } shown } => TypedResults.Conflict(shown.For(display: true)),
                _ => result,
            };
        });
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
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        // Only a parent says what is private.
        request = user.IsDisplay() ? request with { Private = null } : request;
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

        draft = draft! with { Id = creationId };
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
                ? RowFor(new GoogleEvent(id, null, draft.Title, draft.Location, draft.StartsAt, draft.EndsAt, draft.StartDate, draft.EndDate,
                    Description: draft.Description, MemberIds: draft.MemberIds, Private: draft.Private ?? false))
                : EventSeries.Occurrences(draft, id, Today(time, zone).AddDays(CalendarSync.Ahead.Days), zone)
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
    /// whole event or series, so an occurrence on its own stays in its calendar. A rule on an
    /// event that does not repeat yet makes it the first event of a new series; a new rule for a
    /// whole series replaces its rule, and Google then expands it again from the series' first
    /// event. Answers 409 with the event as Google has it now when it changed there first.
    /// </summary>
    private static async Task<Results<Ok<EventResponse>, Conflict<EventResponse>, ValidationProblem, ProblemHttpResult, NotFound>> Change(
        Guid id,
        EventRequest request,
        WheelhouseDbContext db,
        GoogleTokens tokens,
        IGoogleCalendar google,
        CalendarSync sync,
        CalendarSyncTrigger syncSoon,
        TimeProvider time,
        IOptions<InstanceOptions> instance,
        ILogger<GoogleConnection> logger,
        ClaimsPrincipal user,
        CancellationToken cancellationToken,
        bool series = false,
        bool following = false)
    {
        var row = await db.EventInstances.SingleOrDefaultAsync(e => e.Id == id, cancellationToken);
        if (row is null)
        {
            return TypedResults.NotFound();
        }

        if (user.IsDisplay())
        {
            if (await TouchesPrivateAsync(row, series || following, db, cancellationToken))
            {
                return PrivateOnDisplay();
            }

            request = request with { Private = null };
        }

        series &= row.RecurringEventId is not null;
        following &= row.RecurringEventId is not null && !series;
        var (draft, errors) = await DraftAsync(request, db, cancellationToken);
        var rule = draft?.Recurrence;
        var startsSeries = row.RecurringEventId is null && rule is not null;
        // A rule sent with a change to one occurrence is ignored: an occurrence has no rule of its own.
        var newRule = series && rule is not null && rule != row.Recurrence;
        if (draft is not null)
        {
            draft = draft with { Recurrence = startsSeries || newRule || following ? rule : null };
        }

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
        else if (errors is null && from != to && row.RecurringEventId is not null && !following)
        {
            errors = new() { ["calendarId"] = ["One event of a series stays in the series' calendar. Change all events to move them."] };
        }

        if (errors is not null)
        {
            return TypedResults.ValidationProblem(errors);
        }

        if (following)
        {
            if (await SplitAsync(row, draft!, from, to!, db, tokens, google, sync, syncSoon, time, instance, logger, cancellationToken) is { } split)
            {
                return split;
            }

            // The event is its series' first, so it and every later one is the whole series.
            series = true;
            newRule = rule is not null && rule != row.Recurrence;
            if (EventSeries.Errors(row, request, Zone(draft!)) is { } seriesErrors)
            {
                return TypedResults.ValidationProblem(seriesErrors);
            }
        }

        if (IsDemo(instance))
        {
            if (newRule)
            {
                var onDay = await RepeatAgainAsync(row, draft!, to!, Today(time, Zone(draft!)), db, cancellationToken);
                await db.SaveChangesAsync(cancellationToken);
                return TypedResults.Ok(EventResponse.From(onDay, to!));
            }

            if (series)
            {
                EventSeries.Apply(await SeriesOf(row, db, cancellationToken), draft!, Zone(draft!));
                await MoveSeriesAsync(row, to!, db, cancellationToken);
            }
            else if (startsSeries)
            {
                // The event becomes the series' first occurrence and keeps its id, so the screen's event stays put.
                // Notes left out of the request stay the event's notes, in every occurrence.
                var newSeries = EventSeries.Occurrences(
                    draft! with { Description = draft.Description ?? row.Description, MemberIds = draft.MemberIds ?? row.MemberIds, Private = draft.Private ?? row.IsPrivate },
                    row.GoogleEventId,
                    Today(time, Zone(draft!)).AddDays(CalendarSync.Ahead.Days), Zone(draft!)).ToList();
                for (var n = 0; n < newSeries.Count; n++)
                {
                    var occurrenceRow = row;
                    if (n > 0)
                    {
                        occurrenceRow = new EventInstance { Id = Guid.CreateVersion7(), FamilyId = row.FamilyId, GoogleEventId = "", Title = "" };
                        db.EventInstances.Add(occurrenceRow);
                    }

                    occurrenceRow.GoogleEventId = newSeries[n].Id;
                    occurrenceRow.CalendarSourceId = to!.Id;
                    CalendarSync.CopyTo(occurrenceRow, newSeries[n]);
                }
            }
            else
            {
                CalendarSync.CopyTo(row, new GoogleEvent(row.GoogleEventId, row.RecurringEventId, draft!.Title, draft.Location,
                    draft.StartsAt, draft.EndsAt, draft.StartDate, draft.EndDate, Description: draft.Description ?? row.Description,
                    MemberIds: draft.MemberIds ?? row.MemberIds, Private: draft.Private ?? row.IsPrivate));
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

                CalendarSync.CopyTo(row, startsSeries ? stored with { RecurringEventId = stored.Id } : stored);
                row.CalendarSourceId = to!.Id;
                if (!startsSeries)
                {
                    await db.SaveChangesAsync(cancellationToken);
                    return TypedResults.Ok(EventResponse.From(row, to));
                }
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
        // calendars are read again; a new series is read for its occurrences. The answer is the
        // occurrence on the day that was on screen.
        var zone = Zone(draft!);
        var (seriesId, day) = (row.RecurringEventId!, startsSeries ? request.StartDate : EventSeries.DayOf(row, zone));
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
            var startedAs = startsSeries ? row : null;
            db.ChangeTracker.Clear();
            row = await db.EventInstances.SingleAsync(e => e.Id == id, cancellationToken);
            if (startedAs is not null)
            {
                // Until the next sync brings in its occurrences, the new series shows as its first event.
                CalendarSync.CopyTo(row, new GoogleEvent(row.GoogleEventId, seriesId, startedAs.Title, startedAs.Location,
                    startedAs.StartsAt, startedAs.EndsAt, startedAs.StartDate, startedAs.EndDate, startedAs.ETag,
                    startedAs.Description, draft!.Recurrence, startedAs.MemberIds, startedAs.IsPrivate));
                row.CalendarSourceId = to!.Id;
            }
            else
            {
                EventSeries.Apply(await SeriesOf(row, db, cancellationToken), draft!, zone);
                await MoveSeriesAsync(row, to!, db, cancellationToken);
            }

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
        ClaimsPrincipal user,
        CancellationToken cancellationToken,
        bool series = false,
        bool following = false)
    {
        var row = await db.EventInstances.SingleOrDefaultAsync(e => e.Id == id, cancellationToken);
        if (row is null)
        {
            return TypedResults.NotFound();
        }

        if (user.IsDisplay() && await TouchesPrivateAsync(row, series || following, db, cancellationToken))
        {
            return PrivateOnDisplay();
        }

        series &= row.RecurringEventId is not null;
        following &= row.RecurringEventId is not null && !series;
        var source = await db.CalendarSources.SingleAsync(s => s.Id == row.CalendarSourceId, cancellationToken);
        if (WritableErrors(source) is { } errors)
        {
            return TypedResults.ValidationProblem(errors);
        }

        if (following)
        {
            var ended = await EndAsync(row, source, db, tokens, google, instance, logger, cancellationToken);
            if (ended is not null)
            {
                return ended;
            }

            // The event is its series' first, so it and every later one is the whole series.
            series = true;
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

    /// <summary>
    /// Changes <paramref name="row"/> and every later event of its series: the series is ended the day
    /// before, and a new series starts with the change, repeating by the request's rule or, without
    /// one, the old rule with whatever count it had left. Answers the new series' first event, or null
    /// when the row is the series' first, so the change is for the whole series.
    /// </summary>
    private static async Task<Results<Ok<EventResponse>, Conflict<EventResponse>, ValidationProblem, ProblemHttpResult, NotFound>?> SplitAsync(
        EventInstance row,
        GoogleEventDraft draft,
        CalendarSource from,
        CalendarSource to,
        WheelhouseDbContext db,
        GoogleTokens tokens,
        IGoogleCalendar google,
        CalendarSync sync,
        CalendarSyncTrigger syncSoon,
        TimeProvider time,
        IOptions<InstanceOptions> instance,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        // Notes and people left out of the request stay the event's in the new series.
        draft = draft with { Description = draft.Description ?? row.Description, MemberIds = draft.MemberIds ?? row.MemberIds, Private = draft.Private ?? row.IsPrivate };
        var zone = Zone(draft);
        var day = EventSeries.DayOf(row, zone);
        if (IsDemo(instance))
        {
            var rows = await SeriesOf(row, db, cancellationToken);
            var first = rows.Min(e => EventSeries.DayOf(e, zone));
            if (day <= first)
            {
                return null;
            }

            if (RepeatRules.Parse(row.Recurrence, zone) is not { } demoRule)
            {
                return TypedResults.ValidationProblem(SplitErrors());
            }

            var (demoBefore, demoAfter) = SplitRule(demoRule, first, day, draft, row.IsAllDay, zone);
            EndCached(rows, day, demoBefore, db, zone);
            var newRows = EventSeries.Occurrences(draft with { Recurrence = demoAfter }, Guid.NewGuid().ToString("N"),
                    Today(time, zone).AddDays(CalendarSync.Ahead.Days), zone)
                .Select(occurrence => NewRow(row.FamilyId, to, occurrence, db))
                .ToList();
            await db.SaveChangesAsync(cancellationToken);
            return TypedResults.Ok(EventResponse.From(newRows[0], to));
        }

        var write = await GoogleWrite.StartAsync(db, tokens, google, logger, cancellationToken);
        if (write.Problem is { } problem)
        {
            return problem;
        }

        GoogleEvent stored;
        string before;
        try
        {
            var current = await google.GetEventAsync(write.AccessToken!, from.GoogleCalendarId, row.GoogleEventId, cancellationToken);
            var master = await google.GetEventAsync(write.AccessToken!, from.GoogleCalendarId, row.RecurringEventId!, cancellationToken);
            if (current?.ETag != row.ETag || master is null)
            {
                return await write.ShowAsync(row, from, master is null ? null : current, cancellationToken) is { } shown
                    ? TypedResults.Conflict(shown)
                    : TypedResults.NotFound();
            }

            var first = master.StartDate ?? EventSeries.DayOf(master.StartsAt!.Value, zone);
            if (day <= first)
            {
                return null;
            }

            if (RepeatRules.Parse(master.Recurrence, zone) is not { } rule)
            {
                return TypedResults.ValidationProblem(SplitErrors());
            }

            (before, var after) = SplitRule(rule, first, day, draft, master.StartDate is not null, zone);
            // The new series goes in first: should ending the old one then fail, events show twice rather than not at all.
            stored = await google.InsertEventAsync(write.AccessToken!, to.GoogleCalendarId, draft with { Recurrence = after, Id = null }, cancellationToken);
            await google.PatchEventAsync(write.AccessToken!, from.GoogleCalendarId, master.Id, master.ETag,
                new GoogleEventDraft(master.Title, master.Location, master.StartsAt, master.EndsAt, master.StartDate, master.EndDate, draft.TimeZone, Recurrence: before),
                cancellationToken);
        }
        catch (GoogleEventChangedException)
        {
            return await write.RefreshAsync(row, from, cancellationToken) is { } current
                ? TypedResults.Conflict(current)
                : TypedResults.NotFound();
        }
        catch (Exception exception) when (GoogleWrite.IsProblem(exception))
        {
            return await write.ProblemFor(exception, from, cancellationToken);
        }

        try
        {
            await sync.ListAsync(from, write.AccessToken!, cancellationToken);
            if (from != to)
            {
                await sync.ListAsync(to, write.AccessToken!, cancellationToken);
            }

            await db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception exception) when (GoogleWrite.IsProblem(exception))
        {
            logger.LogWarning(exception, "Google could not be reached to read a split series; the next sync brings it in.");
            syncSoon.SyncSoon(row.FamilyId);
            db.ChangeTracker.Clear();
            row = await db.EventInstances.SingleAsync(e => e.Id == row.Id, cancellationToken);
            EndCached(await SeriesOf(row, db, cancellationToken), day, before, db, zone);
            // Until the next sync brings in its occurrences, the new series shows as its first event.
            NewRow(row.FamilyId, to, stored with { RecurringEventId = stored.Id }, db);
            await db.SaveChangesAsync(cancellationToken);
        }

        var answer = await db.EventInstances
            .Where(e => e.CalendarSourceId == to.Id && e.RecurringEventId == stored.Id)
            .OrderBy(e => e.StartDate).ThenBy(e => e.StartsAt)
            .FirstOrDefaultAsync(cancellationToken);
        return answer is null ? TypedResults.NotFound() : TypedResults.Ok(EventResponse.From(answer, to));
    }

    /// <summary>
    /// Deletes <paramref name="row"/> and every later event of its series by ending the series the
    /// day before. Null when the row is the series' first, so the whole series goes.
    /// </summary>
    private static async Task<Results<NoContent, Conflict<EventResponse>, ValidationProblem, ProblemHttpResult, NotFound>?> EndAsync(
        EventInstance row,
        CalendarSource source,
        WheelhouseDbContext db,
        GoogleTokens tokens,
        IGoogleCalendar google,
        IOptions<InstanceOptions> instance,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var timeZone = await db.Families.Select(f => f.TimeZone).SingleAsync(cancellationToken);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        var day = EventSeries.DayOf(row, zone);
        var rows = await SeriesOf(row, db, cancellationToken);
        string before;
        if (IsDemo(instance))
        {
            var first = rows.Min(e => EventSeries.DayOf(e, zone));
            if (day <= first)
            {
                return null;
            }

            before = RepeatRules.Parse(row.Recurrence, zone) is { } rule
                ? RepeatRules.Format(rule with { Count = null, Until = day.AddDays(-1) }, row.IsAllDay, zone)
                : row.Recurrence!;
        }
        else
        {
            var write = await GoogleWrite.StartAsync(db, tokens, google, logger, cancellationToken);
            if (write.Problem is { } problem)
            {
                return problem;
            }

            try
            {
                var current = await google.GetEventAsync(write.AccessToken!, source.GoogleCalendarId, row.GoogleEventId, cancellationToken);
                var master = await google.GetEventAsync(write.AccessToken!, source.GoogleCalendarId, row.RecurringEventId!, cancellationToken);
                if (current is null || master is null)
                {
                    db.EventInstances.Remove(row);
                    await db.SaveChangesAsync(cancellationToken);
                    return TypedResults.NoContent();
                }

                if (current.ETag != row.ETag)
                {
                    return TypedResults.Conflict((await write.ShowAsync(row, source, current, cancellationToken))!);
                }

                var first = master.StartDate ?? EventSeries.DayOf(master.StartsAt!.Value, zone);
                if (day <= first)
                {
                    return null;
                }

                if (RepeatRules.Parse(master.Recurrence, zone) is not { } rule)
                {
                    return TypedResults.ValidationProblem(SplitErrors());
                }

                before = RepeatRules.Format(rule with { Count = null, Until = day.AddDays(-1) }, master.StartDate is not null, zone);
                await google.PatchEventAsync(write.AccessToken!, source.GoogleCalendarId, master.Id, master.ETag,
                    new GoogleEventDraft(master.Title, master.Location, master.StartsAt, master.EndsAt, master.StartDate, master.EndDate, timeZone, Recurrence: before),
                    cancellationToken);
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

        EndCached(rows, day, before, db, zone);
        await db.SaveChangesAsync(cancellationToken);
        return TypedResults.NoContent();
    }

    /// <summary>
    /// A series' rule split at <paramref name="day"/>: the old series ends the day before, and the new
    /// one repeats by the change's own rule or else the old one, with the count it had left.
    /// </summary>
    private static (string Before, string After) SplitRule(
        RepeatRule rule, DateOnly first, DateOnly day, GoogleEventDraft draft, bool allDayBefore, TimeZoneInfo zone)
    {
        var before = RepeatRules.Format(rule with { Count = null, Until = day.AddDays(-1) }, allDayBefore, zone);
        if (draft.Recurrence is { } after)
        {
            return (before, after);
        }

        var taken = RepeatRules.Days(first, rule, day.AddDays(-1)).Count();
        return (before, RepeatRules.Format(rule with { Count = rule.Count - taken }, draft.StartDate is not null, zone));
    }

    /// <summary>Ends cached occurrences of a series at <paramref name="day"/>, as Google ends them, with the rule it now has.</summary>
    private static void EndCached(IEnumerable<EventInstance> rows, DateOnly day, string rule, WheelhouseDbContext db, TimeZoneInfo zone)
    {
        foreach (var occurrence in rows)
        {
            if (EventSeries.DayOf(occurrence, zone) >= day)
            {
                db.EventInstances.Remove(occurrence);
            }
            else
            {
                occurrence.Recurrence = rule;
            }
        }
    }

    private static Dictionary<string, string[]> SplitErrors() =>
        new() { ["recurrence"] = ["This series repeats in a way only Google Calendar can split. Change all events, or this one."] };

    private static EventInstance NewRow(Guid familyId, CalendarSource source, GoogleEvent stored, WheelhouseDbContext db)
    {
        var row = new EventInstance { Id = Guid.CreateVersion7(), FamilyId = familyId, CalendarSourceId = source.Id, GoogleEventId = stored.Id, Title = "" };
        CalendarSync.CopyTo(row, stored);
        db.EventInstances.Add(row);
        return row;
    }

    /// <summary>The cached occurrences of <paramref name="row"/>'s series in its calendar, itself included.</summary>
    /// <summary>
    /// Whether a change to <paramref name="row"/>, or with <paramref name="wholeSeries"/> to its
    /// series, would reach a private event. A series counts as a whole, so a display cannot reach
    /// a private occurrence through another one.
    /// </summary>
    private static async Task<bool> TouchesPrivateAsync(
        EventInstance row, bool wholeSeries, WheelhouseDbContext db, CancellationToken cancellationToken) =>
        row.IsPrivate
        || (wholeSeries && row.RecurringEventId is not null && await db.EventInstances.AnyAsync(
            e => e.CalendarSourceId == row.CalendarSourceId && e.RecurringEventId == row.RecurringEventId && e.IsPrivate,
            cancellationToken));

    private static Task<List<EventInstance>> SeriesOf(EventInstance row, WheelhouseDbContext db, CancellationToken cancellationToken) =>
        db.EventInstances
            .Where(e => e.CalendarSourceId == row.CalendarSourceId && e.RecurringEventId == row.RecurringEventId)
            .ToListAsync(cancellationToken);

    /// <summary>
    /// Gives a demo series <paramref name="draft"/>'s new rule, expanded again from its first cached
    /// event, keeping the rows of the days it still falls on. Answers the occurrence on
    /// <paramref name="row"/>'s day, or the series' first when the new rule skips that day.
    /// </summary>
    private static async Task<EventInstance> RepeatAgainAsync(
        EventInstance row, GoogleEventDraft draft, CalendarSource to, DateOnly today, WheelhouseDbContext db, CancellationToken cancellationToken)
    {
        var zone = Zone(draft);
        var rows = await SeriesOf(row, db, cancellationToken);
        var byDay = new Dictionary<DateOnly, EventInstance>();
        var doubled = rows.Where(e => !byDay.TryAdd(EventSeries.DayOf(e, zone), e)).ToList();
        var first = byDay.Keys.Min();
        var master = EventSeries.MasterDraft(new GoogleEvent("", null, "", null, null, null, first, first), draft, zone);
        var kept = new List<EventInstance>();
        foreach (var occurrence in EventSeries.Occurrences(master, row.RecurringEventId!, today.AddDays(CalendarSync.Ahead.Days), zone))
        {
            var day = occurrence.StartDate ?? EventSeries.DayOf(occurrence.StartsAt!.Value, zone);
            if (!byDay.Remove(day, out var occurrenceRow))
            {
                // A new event of the series takes the changed event's notes unless the change gives new ones.
                occurrenceRow = new EventInstance { Id = Guid.CreateVersion7(), FamilyId = row.FamilyId, GoogleEventId = occurrence.Id, Title = "", Description = row.Description, MemberIds = row.MemberIds, IsPrivate = row.IsPrivate };
                db.EventInstances.Add(occurrenceRow);
            }

            CalendarSync.CopyTo(occurrenceRow, occurrence with
            {
                Id = occurrenceRow.GoogleEventId, Description = draft.Description ?? occurrenceRow.Description, MemberIds = draft.MemberIds ?? occurrenceRow.MemberIds,
                Private = draft.Private ?? occurrenceRow.IsPrivate,
            });
            occurrenceRow.CalendarSourceId = to.Id;
            kept.Add(occurrenceRow);
        }

        db.EventInstances.RemoveRange([.. byDay.Values, .. doubled]);
        var onDay = EventSeries.DayOf(row, zone);
        return kept.FirstOrDefault(e => EventSeries.DayOf(e, zone) == onDay) ?? kept[0];
    }

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

        // Null leaves the notes as they are; empty clears them.
        var description = request.Description?.Trim();
        if (description is { Length: > MaxDescription })
        {
            errors["description"] = [$"Keep the notes to {MaxDescription} characters."];
        }

        // Null leaves the people as they are; the calendar's owner is the event's already.
        var memberIds = request.MemberIds?.Distinct().ToList();
        if (memberIds is { Count: > 0 })
        {
            var known = await db.Members.Where(m => memberIds.Contains(m.Id)).CountAsync(cancellationToken);
            if (known != memberIds.Count)
            {
                errors["memberIds"] = ["Choose people from the family."];
            }
        }

        var timeZone = await db.Families.Select(f => f.TimeZone).SingleAsync(cancellationToken);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        var rule = EventSeries.RuleFor(request.Repeat);
        if (!string.IsNullOrWhiteSpace(request.Recurrence))
        {
            var parsed = RepeatRules.Parse(request.Recurrence, zone);
            if (parsed is null)
            {
                errors["recurrence"] = ["Choose one of the repeats the calendar offers."];
            }
            else if (parsed.Until < request.StartDate)
            {
                errors["recurrence"] = ["End the repeat on or after the event's first day."];
            }
            else
            {
                rule = RepeatRules.Format(parsed, request.AllDay, zone);
            }
        }

        GoogleEventDraft? draft = null;
        if (request.EndDate.DayNumber - request.StartDate.DayNumber > MaxDays)
        {
            errors["endDate"] = ["Keep an event to five years or less."];
        }
        else if (request.AllDay)
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

        return errors.Count == 0 ? (draft! with { Description = description, Recurrence = rule, MemberIds = memberIds, Private = request.Private }, null) : (null, errors);
    }

    /// <summary>A display shows a private event only as busy, so it may not change or delete one.</summary>
    private static ProblemHttpResult PrivateOnDisplay() => TypedResults.Problem(
        statusCode: StatusCodes.Status403Forbidden, title: "Private event",
        detail: "This event is private. Change it from a parent's phone.");

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
