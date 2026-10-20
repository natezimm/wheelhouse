using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Meals;

public static class MealEndpoints
{
    public static readonly string[] Slots = ["Breakfast", "Lunch", "Dinner"];

    public static IEndpointRouteBuilder MapMeals(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/meals").RequireAuthorization(Policies.Family);
        group.MapGet("", Read);
        group.MapPut("/{date}/{slot}", Save);
        group.MapPost("/copy", Copy);
        return app;
    }

    private static bool Range(DateOnly from, DateOnly to) => from.Year is >= 1900 and < 2200 && to <= new DateOnly(2200, 1, 1) && to.DayNumber - from.DayNumber is > 0 and <= 14;
    private static IResult Invalid() => Results.ValidationProblem(new Dictionary<string, string[]> {
        ["meal"] = ["Choose a valid date (1900–2199), Breakfast/Lunch/Dinner, a title up to 200 characters and notes up to 2000. Copy 1–21 unique populated slots between non-overlapping weeks with reviewed versions."] });
    private static string? Text(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static Task<int> Lock(WheelhouseDbContext db, CancellationToken ct) => db.Database.ExecuteSqlInterpolatedAsync(
        $"SELECT pg_advisory_xact_lock(hashtextextended({db.CurrentFamilyId!.Value.ToString()}, 61))", ct);

    private static async Task<IResult> Read(DateOnly from, DateOnly to, WheelhouseDbContext db, CancellationToken ct)
    {
        if (!Range(from, to)) return Invalid();
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var snapshot = await Response(from, to, db, ct); await tx.CommitAsync(ct); return Results.Ok(snapshot);
    }

    private static async Task<MealsResponse> Response(DateOnly from, DateOnly to, WheelhouseDbContext db, CancellationToken ct)
    {
        var revision = await db.Families.Select(f => f.MealsChangeNumber).SingleAsync(ct);
        var rows = await db.MealSlots.AsNoTracking().Where(m => m.Date >= from && m.Date < to).ToArrayAsync(ct);
        var byKey = rows.ToDictionary(m => (m.Date, m.Slot));
        var meals = new List<MealResponse>();
        for (var date = from; date < to; date = date.AddDays(1))
            foreach (var slot in Slots)
            {
                byKey.TryGetValue((date, slot), out var row);
                meals.Add(new(date, slot, row?.Title, row?.Notes, row?.Version,
                    row?.RecipeData is { } json ? RecipeJson.Read<RecipeSnapshot>(json) : null, row?.Servings));
            }
        return new(from, to, revision, meals.ToArray());
    }

    private static async Task<IResult> Save(DateOnly date, string slot, SaveMeal request, WheelhouseDbContext db, CancellationToken ct)
    {
        if (date.Year is < 1900 or >= 2200 || !Slots.Contains(slot) || request.CommandId == Guid.Empty) return Invalid();
        var title = Text(request.Title); var notes = Text(request.Notes);
        if (title?.Length > 200 || notes?.Length > 2000 || title is null && notes is not null) return Invalid();
        if (request.Servings is < 1 or > 100 || request.RemoveRecipe && request.Recipe is not null
            || request.Recipe is { } choice && (choice.Id == Guid.Empty || choice.Version == Guid.Empty)) return Invalid();
        var fingerprint = JsonSerializer.Serialize(new { kind = "save", date, slot, title, notes, request.Version, request.Recipe, request.Servings, request.RemoveRecipe });
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(db, ct);
        var receipt = await db.MealCommands.SingleOrDefaultAsync(c => c.Id == request.CommandId, ct);
        if (receipt is not null && receipt.Request != fingerprint) return Results.Conflict(new { message = "This save ID belongs to another request." });
        if (receipt is null)
        {
            var row = await db.MealSlots.SingleOrDefaultAsync(m => m.Date == date && m.Slot == slot, ct);
            if (row?.Version != request.Version) return Results.Conflict(await Response(date, date.AddDays(1), db, ct));
            var recipeData = title is null || request.RemoveRecipe ? null : row?.RecipeData;
            var servings = recipeData is null ? (int?)null : request.Servings ?? row?.Servings;
            if (request.Recipe is { } selected)
            {
                var recipe = await db.Recipes.SingleOrDefaultAsync(r => r.Id == selected.Id, ct);
                if (recipe is null) return Results.NotFound();
                if (recipe.Archived || recipe.Version != selected.Version) return Results.Conflict(new { message = "Recipe changed. Review the library before choosing again." });
                var content = RecipeJson.Read<RecipeContent>(recipe.Content);
                title = content.Title; recipeData = RecipeJson.Write(new RecipeSnapshot(recipe.Id, recipe.Version, content));
                servings = request.Servings ?? content.DefaultServings;
            }
            else if (recipeData is not null && title != row?.Title) return Invalid();
            if (recipeData is null && request.Servings is not null) return Invalid();
            if (row?.Title != title || row?.Notes != notes || row?.RecipeData != recipeData || row?.Servings != servings)
            {
                row ??= New(db, date, slot);
                row.Title = title; row.Notes = notes; row.RecipeData = recipeData; row.Servings = servings; row.Version = Guid.NewGuid();
            }
            db.MealCommands.Add(new MealCommand { Id = request.CommandId, FamilyId = db.CurrentFamilyId!.Value, Request = fingerprint });
            await db.SaveChangesAsync(ct);
        }
        var result = await Response(date, date.AddDays(1), db, ct); await tx.CommitAsync(ct); return Results.Ok(result);
    }

    private static async Task<IResult> Copy(CopyMeals request, WheelhouseDbContext db, CancellationToken ct)
    {
        if (request.CommandId == Guid.Empty || request.SourceFrom.Year is < 1900 or >= 2200 || request.TargetFrom.Year is < 1900 or >= 2200
            || request.SourceFrom > new DateOnly(2199, 12, 24) || request.TargetFrom > new DateOnly(2199, 12, 24)
            || Math.Abs(request.SourceFrom.DayNumber - request.TargetFrom.DayNumber) < 7
            || request.Items is not { Length: > 0 and <= 21 } || request.Items.Any(i => i is null || !Slots.Contains(i.Slot)
                || i.Date < request.SourceFrom || i.Date >= request.SourceFrom.AddDays(7) || i.SourceVersion == Guid.Empty)
            || request.Items.Select(i => (i.Date, i.Slot)).Distinct().Count() != request.Items.Length) return Invalid();
        var choices = request.Items.OrderBy(i => i.Date).ThenBy(i => i.Slot).ToArray();
        var fingerprint = JsonSerializer.Serialize(new { kind = "copy", request.SourceFrom, request.TargetFrom, items = choices });
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(db, ct);
        var receipt = await db.MealCommands.SingleOrDefaultAsync(c => c.Id == request.CommandId, ct);
        if (receipt is not null && receipt.Request != fingerprint) return Results.Conflict(new { message = "This save ID belongs to another request." });
        if (receipt is null)
        {
            var sources = await db.MealSlots.Where(m => m.Date >= request.SourceFrom && m.Date < request.SourceFrom.AddDays(7)).ToArrayAsync(ct);
            var targets = await db.MealSlots.Where(m => m.Date >= request.TargetFrom && m.Date < request.TargetFrom.AddDays(7)).ToArrayAsync(ct);
            foreach (var choice in choices)
            {
                var source = sources.SingleOrDefault(m => m.Date == choice.Date && m.Slot == choice.Slot);
                var date = request.TargetFrom.AddDays(choice.Date.DayNumber - request.SourceFrom.DayNumber);
                var target = targets.SingleOrDefault(m => m.Date == date && m.Slot == choice.Slot);
                if (source?.Title is null || source.Version != choice.SourceVersion || target?.Version != choice.TargetVersion)
                    return Results.Conflict(new { message = "Source or destination meals changed. Review the copy again." });
            }
            foreach (var choice in choices)
            {
                var source = sources.Single(m => m.Date == choice.Date && m.Slot == choice.Slot);
                var date = request.TargetFrom.AddDays(choice.Date.DayNumber - request.SourceFrom.DayNumber);
                var target = targets.SingleOrDefault(m => m.Date == date && m.Slot == choice.Slot);
                if (target?.Title == source.Title && target?.Notes == source.Notes && target?.RecipeData == source.RecipeData && target?.Servings == source.Servings) continue;
                target ??= New(db, date, choice.Slot);
                target.Title = source.Title; target.Notes = source.Notes; target.RecipeData = source.RecipeData; target.Servings = source.Servings; target.Version = Guid.NewGuid();
            }
            db.MealCommands.Add(new MealCommand { Id = request.CommandId, FamilyId = db.CurrentFamilyId!.Value, Request = fingerprint });
            await db.SaveChangesAsync(ct);
        }
        var result = await Response(request.TargetFrom, request.TargetFrom.AddDays(7), db, ct);
        await tx.CommitAsync(ct); return Results.Ok(result);
    }

    private static MealSlot New(WheelhouseDbContext db, DateOnly date, string slot)
    {
        var row = new MealSlot { Id = Guid.CreateVersion7(), FamilyId = db.CurrentFamilyId!.Value, Date = date, Slot = slot };
        db.MealSlots.Add(row); return row;
    }
}
