using System.Data;
using System.Security.Claims;
using System.Text.Json;
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
        group.MapGet("/{id:guid}", async (Guid id, WheelhouseDbContext db, CancellationToken ct) =>
            await db.Chores.AsNoTracking().SingleOrDefaultAsync(c => c.Id == id, ct) is { } c
                ? Results.Ok(ChoreResponse.From(c)) : Results.NotFound());
        group.MapGet("/creation/{id:guid}", async (Guid id, WheelhouseDbContext db, CancellationToken ct) =>
            await db.Chores.AsNoTracking().SingleOrDefaultAsync(c => c.CreationId == id, ct) is { } c
                ? Results.Ok(ChoreResponse.From(c)) : Results.NotFound());
        group.MapPost("", Create).RequireAuthorization(Policies.Parent);
        group.MapPut("/{id:guid}", Edit).RequireAuthorization(Policies.Parent);
        group.MapPut("/{id:guid}/completion", Complete);
        group.MapPut("/{id:guid}/archive", Archive).RequireAuthorization(Policies.Parent);
        return app;
    }

    private static async Task<IResult> Snapshot(DateOnly date, ClaimsPrincipal user, WheelhouseDbContext db, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var revision = await db.Families.Select(f => (long?)f.ChoresChangeNumber).SingleOrDefaultAsync(ct);
        if (revision is null) return Results.NotFound();
        // Earlier outstanding chores remain actionable; earlier completed chores belong to their due day.
        var chores = await db.Chores.AsNoTracking().Where(c => !c.Archived &&
            (c.DueDate == date || (c.DueDate < date && c.CompletedAt == null)))
            .OrderBy(c => c.DueDate).ThenBy(c => c.Title).ThenBy(c => c.Id).ToArrayAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(new ChoresResponse(revision.Value, chores.Select(ChoreResponse.From).ToArray(),
            user.HasClaim(WheelhouseClaims.Role, Roles.Parent)));
    }

    private static async Task<IResult> Create(CreateChore request, WheelhouseDbContext db, CancellationToken ct)
    {
        var draft = Normalize(request.Title, request.Notes, request.MemberId, request.DueDate);
        if (request.CreationId == Guid.Empty || !Valid(draft)) return Invalid();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(db, ct);
        var fingerprint = JsonSerializer.Serialize(draft);
        var existing = await db.Chores.SingleOrDefaultAsync(c => c.CreationId == request.CreationId, ct);
        if (existing is not null)
            return existing.CreationRequest == fingerprint ? Results.Ok(ChoreResponse.From(existing))
                : Results.Conflict(new { message = "This save ID was already used for a different chore." });
        if (!await MemberAllowed(draft.MemberId, db, ct)) return Invalid();
        var chore = new Chore
        {
            Id = Guid.CreateVersion7(), FamilyId = db.CurrentFamilyId!.Value,
            CreationId = request.CreationId, CreationRequest = fingerprint, Title = draft.Title,
            Notes = draft.Notes, MemberId = draft.MemberId, DueDate = draft.DueDate,
        };
        db.Chores.Add(chore);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Created($"/api/chores/{chore.Id}", ChoreResponse.From(chore));
    }

    private static async Task<IResult> Edit(Guid id, EditChore request, WheelhouseDbContext db, CancellationToken ct)
    {
        var draft = Normalize(request.Title, request.Notes, request.MemberId, request.DueDate);
        if (!Valid(draft) || request.Version == Guid.Empty) return Invalid();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(db, ct);
        var chore = await db.Chores.SingleOrDefaultAsync(c => c.Id == id, ct);
        if (chore is null) return Results.NotFound();
        if (chore.Archived) return Results.Conflict(ChoreResponse.From(chore));
        if (Normalize(chore.Title, chore.Notes, chore.MemberId, chore.DueDate) == draft)
            return Results.Ok(ChoreResponse.From(chore));
        if (chore.Version != request.Version) return Results.Conflict(ChoreResponse.From(chore));
        if (!await MemberAllowed(draft.MemberId, db, ct)) return Invalid();
        chore.Title = draft.Title;
        chore.Notes = draft.Notes;
        chore.MemberId = draft.MemberId;
        chore.DueDate = draft.DueDate;
        chore.Version = Guid.NewGuid();
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(ChoreResponse.From(chore));
    }

    private static async Task<IResult> Complete(Guid id, CompleteChore request, WheelhouseDbContext db, TimeProvider time, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(db, ct);
        var chore = await db.Chores.SingleOrDefaultAsync(c => c.Id == id, ct);
        if (chore is null) return Results.NotFound();
        if (chore.Archived) return Results.Conflict(ChoreResponse.From(chore));
        if ((chore.CompletedAt is not null) == request.Completed) return Results.Ok(ChoreResponse.From(chore));
        if (request.Version != chore.Version) return Results.Conflict(ChoreResponse.From(chore));
        chore.CompletedAt = request.Completed ? time.GetUtcNow() : null;
        chore.Version = Guid.NewGuid();
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(ChoreResponse.From(chore));
    }

    private static async Task<IResult> Archive(Guid id, ArchiveChore request, WheelhouseDbContext db, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(db, ct);
        var chore = await db.Chores.SingleOrDefaultAsync(c => c.Id == id, ct);
        if (chore is null) return Results.NotFound();
        if (chore.Archived) return Results.Ok(ChoreResponse.From(chore));
        if (chore.Version != request.Version) return Results.Conflict(ChoreResponse.From(chore));
        chore.Archived = true;
        chore.Version = Guid.NewGuid();
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(ChoreResponse.From(chore));
    }

    // Serialize same-family commands and creates, including duplicate-key retries. This lock
    // and the revision update live in the write transaction; failed/rolled-back writes publish nothing.
    private static Task<int> Lock(WheelhouseDbContext db, CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({db.CurrentFamilyId!.Value.ToString()}, 41))", ct);

    private static Task<bool> MemberAllowed(Guid? member, WheelhouseDbContext db, CancellationToken ct) =>
        member is null ? Task.FromResult(true) : db.Members.AnyAsync(m => m.Id == member, ct);

    private static ChoreDraft Normalize(string? title, string? notes, Guid? member, DateOnly date) =>
        new(title?.Trim() ?? "", string.IsNullOrWhiteSpace(notes) ? null : notes.Trim(), member, date);

    private static bool Valid(ChoreDraft draft) => draft.Title.Length is > 0 and <= 200
        && draft.Notes?.Length is not > 2000 && draft.DueDate != default;

    private static IResult Invalid() => Results.ValidationProblem(new Dictionary<string, string[]>
    {
        ["chore"] = ["Enter a title (up to 200 characters), a due date, and a member of this household. Notes may contain up to 2000 characters."],
    });
}
