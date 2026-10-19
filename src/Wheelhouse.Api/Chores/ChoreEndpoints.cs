using System.Data;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Chores;

public static class ChoreEndpoints
{
    public static IEndpointRouteBuilder MapChores(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/chores").RequireAuthorization(Policies.Family);
        group.MapGet("", Snapshot);
        group.MapGet("/history", History);
        group.MapGet("/{id:guid}", async (Guid id, DateOnly? date, WheelhouseDbContext db, TimeProvider time, CancellationToken ct) =>
            await Read(id, false, date, db, time, ct));
        group.MapGet("/creation/{id:guid}", async (Guid id, DateOnly? date, WheelhouseDbContext db, TimeProvider time, CancellationToken ct) =>
            await Read(id, true, date, db, time, ct));
        group.MapPost("", Create).RequireAuthorization(Policies.Parent);
        group.MapPut("/{id:guid}", Edit).RequireAuthorization(Policies.Parent);
        group.MapPut("/{id:guid}/completion", Complete);
        group.MapPut("/{id:guid}/archive", Archive).RequireAuthorization(Policies.Parent);
        return app;
    }

    private static async Task<IResult> Snapshot(DateOnly date, ClaimsPrincipal user, WheelhouseDbContext db, TimeProvider time, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var revision = await db.Families.Select(f => (long?)f.ChoresChangeNumber).SingleOrDefaultAsync(ct);
        if (revision is null) return Results.NotFound();
        var today = await Today(db, time, ct);
        // Project one requested day only. Recurring misses never accumulate in today's overdue work.
        var chores = await Rows(db, date).AsNoTracking().Where(c => c.Plans.Any() || (!c.Archived &&
            (c.DueDate == date || (c.DueDate < date && c.CompletedAt == null))))
            .OrderBy(c => c.DueDate).ThenBy(c => c.Title).ThenBy(c => c.Id).ToArrayAsync(ct);
        var response = chores.Select(c => ChoreOccurrences.Response(c, date, today)).Where(c => c.Visible && !c.Archived).ToArray();
        await tx.CommitAsync(ct);
        return Results.Ok(new ChoresResponse(revision.Value, response,
            user.HasClaim(WheelhouseClaims.Role, Roles.Parent)));
    }

    // Dates are due dates in the household zone; the end is exclusive, as with calendar ranges.
    // Keep reads bounded and project occurrences without materializing rows or changing revisions.
    private static async Task<IResult> History(DateOnly from, DateOnly to, ClaimsPrincipal user,
        WheelhouseDbContext db, TimeProvider time, CancellationToken ct)
    {
        if (to <= from || to.DayNumber - from.DayNumber > 31)
            return Invalid("Choose a history range of 1 to 31 days.");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var family = await db.Families.Select(f => new { f.TimeZone, f.ChoresChangeNumber }).SingleOrDefaultAsync(ct);
        if (family is null) return Results.NotFound();
        var today = ChoreOccurrences.Today(family.TimeZone, time.GetUtcNow());
        if (to > today.AddDays(1)) return Invalid("History ends on today or an earlier household date.");
        var chores = await db.Chores.AsNoTracking()
            .Include(c => c.Plans)
            .Include(c => c.Completions.Where(done => done.DueDate >= from && done.DueDate < to))
            .AsSplitQuery()
            .Where(c => c.Plans.Any()
                ? c.Plans.Any(p => p.EffectiveFrom < to && p.StartsOn < to && (p.EndsOn == null || p.EndsOn >= from))
                    && (c.ArchivedFrom == null || c.ArchivedFrom > from)
                : c.DueDate >= from && c.DueDate < to)
            .ToArrayAsync(ct);
        var rows = new List<ChoreResponse>();
        foreach (var chore in chores)
        {
            if (chore.Plans.Count == 0) { rows.Add(ChoreResponse.From(chore)); continue; }
            for (var day = from; day < to; day = day.AddDays(1))
            {
                var occurrence = ChoreOccurrences.Response(chore, day, today);
                if (occurrence.Visible) rows.Add(occurrence);
            }
        }
        await tx.CommitAsync(ct);
        return Results.Ok(new ChoresResponse(family.ChoresChangeNumber,
            rows.OrderByDescending(c => c.DueDate).ThenBy(c => c.Title).ThenBy(c => c.Id).ToArray(),
            user.HasClaim(WheelhouseClaims.Role, Roles.Parent)));
    }

    private static async Task<IResult> Create(CreateChore request, DateOnly? date, WheelhouseDbContext db, TimeProvider time, CancellationToken ct)
    {
        var draft = Normalize(request.Title, request.Notes, request.MemberId, request.DueDate, request.Repeat);
        if (request.CreationId == Guid.Empty || !Valid(draft)) return Invalid();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(db, ct);
        var fingerprint = ChoreOccurrences.Fingerprint(draft);
        var today = await Today(db, time, ct);
        var existing = await Rows(db, date ?? today).SingleOrDefaultAsync(c => c.CreationId == request.CreationId, ct);
        if (existing is not null)
            return existing.CreationRequest == fingerprint ? Results.Ok(ChoreOccurrences.Response(existing, date ?? today, today))
                : Results.Conflict(new { message = "This save ID was already used for a different chore." });
        if (!await MemberAllowed(draft.MemberId, db, ct)) return Invalid();
        var chore = new Chore
        {
            Id = Guid.CreateVersion7(), FamilyId = db.CurrentFamilyId!.Value,
            CreationId = request.CreationId, CreationRequest = fingerprint, Title = draft.Title,
            Notes = draft.Notes, MemberId = draft.MemberId, DueDate = draft.DueDate,
        };
        if (draft.Repeat is not null)
        {
            var plan = new ChorePlan { FamilyId = chore.FamilyId, ChoreId = chore.Id, EffectiveFrom = draft.DueDate,
                Title = draft.Title, Frequency = draft.Repeat.Frequency };
            plan.Apply(draft); chore.Plans.Add(plan);
        }
        db.Chores.Add(chore);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Created($"/api/chores/{chore.Id}", ChoreOccurrences.Response(chore, date ?? today, today));
    }

    private static async Task<IResult> Edit(Guid id, EditChore request, DateOnly? date, WheelhouseDbContext db, TimeProvider time, CancellationToken ct)
    {
        var draft = Normalize(request.Title, request.Notes, request.MemberId, request.DueDate, request.Repeat);
        if (!Valid(draft) || request.Version == Guid.Empty) return Invalid();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(db, ct);
        var today = await Today(db, time, ct);
        var chore = await Rows(db, date ?? today).SingleOrDefaultAsync(c => c.Id == id, ct);
        if (chore is null) return Results.NotFound();
        var current = ChoreOccurrences.Response(chore, date ?? today, today);
        if (chore.Archived) return Results.Conflict(current);
        if ((chore.Plans.Count > 0) != (draft.Repeat is not null)) return Invalid();
        if (ChoreOccurrences.Fingerprint(ChoreOccurrences.Draft(chore)) == ChoreOccurrences.Fingerprint(draft))
            return Results.Ok(current);
        if (chore.Version != request.Version) return Results.Conflict(current);
        if (!await MemberAllowed(draft.MemberId, db, ct)) return Invalid();
        if (draft.Repeat is not null)
        {
            var tomorrow = today.AddDays(1);
            foreach (var future in chore.Plans.Where(p => p.EffectiveFrom > tomorrow).ToArray())
            {
                chore.Plans.Remove(future); db.ChorePlans.Remove(future);
            }
            var plan = chore.Plans.SingleOrDefault(p => p.EffectiveFrom == tomorrow);
            if (plan is null)
            {
                plan = new ChorePlan { FamilyId = chore.FamilyId, ChoreId = chore.Id, EffectiveFrom = tomorrow,
                    Title = draft.Title, Frequency = draft.Repeat.Frequency };
                chore.Plans.Add(plan);
                db.ChorePlans.Add(plan);
            }
            plan.Apply(draft);
        }
        chore.Title = draft.Title;
        chore.Notes = draft.Notes;
        chore.MemberId = draft.MemberId;
        chore.DueDate = draft.DueDate;
        chore.Version = Guid.NewGuid();
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(ChoreOccurrences.Response(chore, date ?? today, today));
    }

    private static async Task<IResult> Complete(Guid id, CompleteChore request, DateOnly? date, WheelhouseDbContext db, TimeProvider time, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(db, ct);
        var chore = await Rows(db, date ?? DateOnly.MinValue).SingleOrDefaultAsync(c => c.Id == id, ct);
        if (chore is null) return Results.NotFound();
        if (chore.Plans.Count > 0)
        {
            var today = await Today(db, time, ct);
            if (date is null || date > today) return Invalid("Repeating chores can be completed on their due date or afterwards. Choose a due date first.");
            var current = ChoreOccurrences.Response(chore, date.Value, today);
            if (!current.Visible) return Results.NotFound();
            if ((current.CompletedAt is not null) == request.Completed) return Results.Ok(current);
            if (current.Version != request.Version) return Results.Conflict(current);
            var completion = chore.Completions.SingleOrDefault(c => c.DueDate == date);
            if (completion is null)
            {
                completion = new ChoreCompletion { FamilyId = chore.FamilyId, ChoreId = id, DueDate = date.Value };
                chore.Completions.Add(completion);
                db.ChoreCompletions.Add(completion);
            }
            completion.CompletedAt = request.Completed ? Instant(time) : null;
            completion.Version = Guid.NewGuid();
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
            return Results.Ok(ChoreOccurrences.Response(chore, date.Value, today));
        }
        if (chore.Archived) return Results.Conflict(ChoreResponse.From(chore));
        if ((chore.CompletedAt is not null) == request.Completed) return Results.Ok(ChoreResponse.From(chore));
        if (request.Version != chore.Version) return Results.Conflict(ChoreResponse.From(chore));
        chore.CompletedAt = request.Completed ? Instant(time) : null;
        chore.Version = Guid.NewGuid();
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(ChoreResponse.From(chore));
    }

    private static async Task<IResult> Archive(Guid id, ArchiveChore request, DateOnly? date, WheelhouseDbContext db, TimeProvider time, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(db, ct);
        var today = await Today(db, time, ct);
        var chore = await Rows(db, date ?? today).SingleOrDefaultAsync(c => c.Id == id, ct);
        if (chore is null) return Results.NotFound();
        if (chore.Archived) return Results.Ok(ChoreOccurrences.Response(chore, date ?? today, today));
        if (chore.Version != request.Version) return Results.Conflict(ChoreOccurrences.Response(chore, date ?? today, today));
        chore.Archived = true;
        if (chore.Plans.Count > 0) chore.ArchivedFrom = today.AddDays(1);
        chore.Version = Guid.NewGuid();
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(ChoreOccurrences.Response(chore, date ?? today, today));
    }

    // Serialize same-family commands and creates, including duplicate-key retries. This lock
    // and the revision update live in the write transaction; failed/rolled-back writes publish nothing.
    private static Task<int> Lock(WheelhouseDbContext db, CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({db.CurrentFamilyId!.Value.ToString()}, 41))", ct);

    private static Task<bool> MemberAllowed(Guid? member, WheelhouseDbContext db, CancellationToken ct) =>
        member is null ? Task.FromResult(true) : db.Members.AnyAsync(m => m.Id == member, ct);

    private static ChoreDraft Normalize(string? title, string? notes, Guid? member, DateOnly date, ChoreRepeat? repeat = null) =>
        new(title?.Trim() ?? "", string.IsNullOrWhiteSpace(notes) ? null : notes.Trim(), member, date,
            repeat is null ? null : repeat with { Weekdays = (repeat.Weekdays ?? []).Distinct().Order().ToArray() });

    private static bool Valid(ChoreDraft draft) => draft.Title.Length is > 0 and <= 200
        && draft.Notes?.Length is not > 2000 && draft.DueDate != default
        && (draft.Repeat is not { } repeat || (repeat.EndsOn is null || repeat.EndsOn >= draft.DueDate)
            && repeat.IntervalWeeks is >= 1 and <= 52
            && (repeat.Frequency == "Daily" && repeat.IntervalWeeks == 1 && repeat.Weekdays!.Length == 0
                || repeat.Frequency == "Weekly" && repeat.Weekdays!.Length is >= 1 and <= 7 && repeat.Weekdays.All(d => d is >= 0 and <= 6)));

    private static IResult Invalid(string? message = null) => Results.ValidationProblem(new Dictionary<string, string[]>
    {
        ["chore"] = [message ?? "Enter a title (up to 200 characters), a due/start date, and a member of this household. Repeats need valid weekdays, an interval from 1 to 52 weeks, and an end on or after their start. Notes may contain up to 2000 characters."],
    });

    private static IQueryable<Chore> Rows(WheelhouseDbContext db, DateOnly date) => db.Chores
        .Include(c => c.Plans).Include(c => c.Completions.Where(completion => completion.DueDate == date));

    private static async Task<DateOnly> Today(WheelhouseDbContext db, TimeProvider time, CancellationToken ct) =>
        ChoreOccurrences.Today(await db.Families.Select(f => f.TimeZone).SingleAsync(ct), time.GetUtcNow());

    private static async Task<IResult> Read(Guid id, bool creation, DateOnly? date, WheelhouseDbContext db, TimeProvider time, CancellationToken ct)
    {
        var today = await Today(db, time, ct);
        var chore = await Rows(db, date ?? today).AsNoTracking().SingleOrDefaultAsync(c => creation ? c.CreationId == id : c.Id == id, ct);
        if (chore is null) return Results.NotFound();
        return Results.Ok(ChoreOccurrences.Response(chore, date ?? today, today));
    }

    private static DateTimeOffset Instant(TimeProvider time)
    {
        var now = time.GetUtcNow();
        return now.AddTicks(-(now.Ticks % TimeSpan.TicksPerMicrosecond));
    }
}
