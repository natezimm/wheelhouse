using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Lists;

public static partial class ListEndpoints
{
    public static IEndpointRouteBuilder MapLists(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/lists").RequireAuthorization(Policies.Family);
        group.MapGet("", Snapshot);
        group.MapPost("", Create);
        group.MapPut("/{id:guid}", Rename);
        group.MapPut("/{id:guid}/archive", Archive);
        group.MapPost("/{id:guid}/items", AddItem);
        group.MapPut("/{id:guid}/items/{itemId:guid}", EditItem);
        group.MapPut("/{id:guid}/items/{itemId:guid}/checked", CheckItem);
        group.MapPut("/{id:guid}/items/{itemId:guid}/move", MoveItem);
        group.MapPut("/{id:guid}/items/{itemId:guid}/delete", DeleteItem);
        group.MapPut("/{id:guid}/categories", Categories);
        group.MapPut("/{id:guid}/clear-checked", ClearChecked);
        return app;
    }

    private static async Task<IResult> Snapshot(WheelhouseDbContext db, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var result = await Response(db, ct);
        await tx.CommitAsync(ct);
        return Results.Ok(result);
    }

    private static async Task<ListsResponse> Response(WheelhouseDbContext db, CancellationToken ct)
    {
        var revision = await db.Families.Select(f => f.ListsChangeNumber).SingleAsync(ct);
        var lists = await db.HouseholdLists.AsNoTracking().Include(l => l.Items).ThenInclude(i=>i.Contributions).Include(l => l.Categories).AsSplitQuery()
            .OrderByDescending(l => l.IsGrocery).ThenBy(l => l.Name).ThenBy(l => l.Id).ToArrayAsync(ct);
        return new(revision, lists.Select(HouseholdListResponse.From).ToArray());
    }

    private static async Task<IResult> Create(CreateList request, WheelhouseDbContext db, CancellationToken ct)
    {
        var name = request.Name?.Trim() ?? "";
        if (request.CreationId == Guid.Empty || name.Length is < 1 or > 100) return Invalid();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(db, ct);
        var existing = await db.HouseholdLists.SingleOrDefaultAsync(l => l.CreationId == request.CreationId, ct);
        if (existing is not null && existing.CreationRequest != name) return Results.Conflict(new { message = "This save ID belongs to a different list." });
        if (existing is null)
        {
            db.HouseholdLists.Add(new HouseholdList { Id = Guid.CreateVersion7(), FamilyId = db.CurrentFamilyId!.Value,
                CreationId = request.CreationId, CreationRequest = name, Name = name });
            await db.SaveChangesAsync(ct);
        }
        var response = await Response(db, ct); await tx.CommitAsync(ct);
        return Results.Ok(response);
    }

    private static Task<IResult> Rename(Guid id, RenameList request, WheelhouseDbContext db, CancellationToken ct) =>
        Change(id, null, db, ct, list =>
        {
            var name = request.Name?.Trim() ?? "";
            if (name.Length is < 1 or > 100) return Invalid();
            if (list.Archived || list.IsGrocery && list.Name != name) return Conflict(list);
            if (list.Name == name) return null;
            if (list.Version != request.Version) return Conflict(list);
            list.Name = name; list.Version = Guid.NewGuid(); return null;
        });

    private static Task<IResult> Archive(Guid id, ListVersion request, WheelhouseDbContext db, CancellationToken ct) =>
        Change(id, null, db, ct, list =>
        {
            if (list.IsGrocery) return Conflict(list);
            if (list.Archived) return null;
            if (list.Version != request.Version) return Conflict(list);
            list.Archived = true; list.Version = Guid.NewGuid(); return null;
        });

    private static async Task<IResult> AddItem(Guid id, CreateListItem request, WheelhouseDbContext db, CancellationToken ct)
    {
        var text = request.Text?.Trim() ?? "";
        var notes = Notes(request.Notes);
        var quantity = Notes(request.Quantity); var unit = Notes(request.Unit);
        if (request.CreationId == Guid.Empty || !Valid(text, notes)) return Invalid();
        if (quantity?.Length > 100 || unit?.Length > 50) return InvalidGrocery();
        return await Change(id, null, db, ct, list =>
        {
            var fingerprint = quantity is null && unit is null && request.CategoryId is null
                ? JsonSerializer.Serialize(new { id, text, notes })
                : JsonSerializer.Serialize(new { id, text, notes, quantity, unit, request.CategoryId });
            var existing = db.ListItems.SingleOrDefault(i => i.CreationId == request.CreationId);
            if (existing is not null) return existing.CreationRequest == fingerprint ? null : Conflict(list);
            if (list.Archived) return Conflict(list);
            if (!GroceryFields(list, quantity, unit, request.CategoryId, out var category)) return InvalidGrocery();
            var item = new ListItem { Id = Guid.CreateVersion7(), FamilyId = list.FamilyId, HouseholdListId = id,
                CreationId = request.CreationId, CreationRequest = fingerprint, Text = text, Notes = notes,
                Quantity = quantity, Unit = unit, CategoryId = category,
                SortOrder = list.Items.Count == 0 ? 0 : list.Items.Max(i => i.SortOrder) + 1 };
            list.Items.Add(item);
            // The client-generated nonempty key must be inserted, not inferred as an existing row.
            db.ListItems.Add(item);
            list.Version = Guid.NewGuid(); return null;
        });
    }

    private static Task<IResult> EditItem(Guid id, Guid itemId, EditListItem request, WheelhouseDbContext db, CancellationToken ct) =>
        ItemChange(id, itemId, request.Version, db, ct, (list, item) =>
        {
            var text = request.Text?.Trim() ?? ""; var notes = Notes(request.Notes);
            var quantity = Notes(request.Quantity); var unit = Notes(request.Unit);
            if (!Valid(text, notes)) return Invalid();
            if (quantity?.Length > 100 || unit?.Length > 50) return InvalidGrocery();
            if (!GroceryFields(list, quantity, unit, request.CategoryId, out var category)) return InvalidGrocery();
            if (item.Text == text && item.Notes == notes && item.Quantity == quantity && item.Unit == unit && item.CategoryId == category) return Results.Ok();
            item.Text = text; item.Notes = notes; item.Quantity = quantity; item.Unit = unit; item.CategoryId = category; return null;
        });

    private static Task<IResult> CheckItem(Guid id, Guid itemId, CheckListItem request, WheelhouseDbContext db, CancellationToken ct) =>
        Change(id, itemId, db, ct, list =>
        {
            var item = list.Items.Single(i => i.Id == itemId);
            if (list.Archived || item.Deleted) return Conflict(list);
            if (item.Checked == request.Checked) return null;
            if (item.Version != request.Version) return Conflict(list);
            item.Checked = request.Checked; item.Version = Guid.NewGuid(); list.Version = Guid.NewGuid(); return null;
        });

    private static Task<IResult> MoveItem(Guid id, Guid itemId, MoveListItem request, WheelhouseDbContext db, CancellationToken ct) =>
        ItemChange(id, itemId, request.Version, db, ct, (list, item) =>
        {
            if (request.Direction is not (-1 or 1)) return Invalid();
            if (list.Version != request.ListVersion) return Conflict(list);
            var rows = list.Items.Where(i => !i.Deleted && i.Checked == item.Checked && (!list.IsGrocery || i.CategoryId == item.CategoryId))
                .OrderBy(i => i.SortOrder).ThenBy(i => i.Id).ToArray();
            var index = Array.IndexOf(rows, item) + request.Direction;
            if (index < 0 || index >= rows.Length) return Results.Ok();
            var neighbour = rows[index];
            (item.SortOrder, neighbour.SortOrder) = (neighbour.SortOrder, item.SortOrder);
            neighbour.Version = Guid.NewGuid(); return null;
        });

    private static Task<IResult> DeleteItem(Guid id, Guid itemId, ListVersion request, WheelhouseDbContext db, CancellationToken ct) =>
        Change(id, itemId, db, ct, list =>
        {
            var item = list.Items.Single(i => i.Id == itemId);
            if (item.Deleted) return null;
            if (list.Archived || item.Version != request.Version) return Conflict(list);
            item.Deleted = true; item.Version = Guid.NewGuid(); list.Version = Guid.NewGuid(); return null;
        });

    private static Task<IResult> ItemChange(Guid id, Guid itemId, Guid version, WheelhouseDbContext db, CancellationToken ct,
        Func<HouseholdList, ListItem, IResult?> mutate) => Change(id, itemId, db, ct, list =>
        {
            var item = list.Items.Single(i => i.Id == itemId);
            if (list.Archived || item.Deleted || item.Version != version) return Conflict(list);
            var result = mutate(list, item);
            if (result is not null) return result is Microsoft.AspNetCore.Http.HttpResults.Ok ? null : result;
            item.Version = Guid.NewGuid(); list.Version = Guid.NewGuid(); return null;
        });

    private static async Task<IResult> Change(Guid id, Guid? itemId, WheelhouseDbContext db, CancellationToken ct, Func<HouseholdList, IResult?> mutate)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(db, ct);
        var list = await db.HouseholdLists.Include(l => l.Items).Include(l => l.Categories).AsSplitQuery().SingleOrDefaultAsync(l => l.Id == id, ct);
        if (list is null || itemId is not null && !list.Items.Any(i => i.Id == itemId)) return Results.NotFound();
        var refusal = mutate(list);
        if (refusal is not null) return refusal;
        await db.SaveChangesAsync(ct);
        var response = await Response(db, ct); await tx.CommitAsync(ct);
        return Results.Ok(response);
    }

    private static Task<int> Lock(WheelhouseDbContext db, CancellationToken ct) => db.Database.ExecuteSqlInterpolatedAsync(
        $"SELECT pg_advisory_xact_lock(hashtextextended({db.CurrentFamilyId!.Value.ToString()}, 51))", ct);
    private static string? Notes(string? notes) => string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
    private static bool Valid(string text, string? notes) => text.Length is > 0 and <= 200 && notes?.Length is not > 2000;
    private static IResult Conflict(HouseholdList list) => Results.Conflict(HouseholdListResponse.From(list));
    private static IResult Invalid() => Results.ValidationProblem(new Dictionary<string, string[]> {
        ["list"] = ["Enter a list name (up to 100 characters) or item text (up to 200). Notes may contain up to 2000 characters."] });
}
