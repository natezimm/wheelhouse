using System.Data;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Meals;

public static class RecipeEndpoints
{
    public static IEndpointRouteBuilder MapRecipes(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/recipes").RequireAuthorization(Policies.Family);
        group.MapGet("", Read);
        group.MapPut("/{id:guid}", Save).RequireAuthorization(Policies.Parent);
        return app;
    }
    private static string? Text(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static RecipeContent? Normalize(RecipeContent? content)
    {
        if (content is null || Text(content.Title) is not { Length: <= 200 } title
            || content.DefaultServings is < 1 or > 100 || content.Ingredients is not { Length: > 0 and <= 100 }
            || content.Steps is not { Length: > 0 and <= 100 } || Text(content.Notes)?.Length > 4000
            || Text(content.SourceUrl)?.Length > 2000) return null;
        if (Text(content.SourceUrl) is { } source && (!Uri.TryCreate(source, UriKind.Absolute, out var url)
            || url.Scheme is not ("http" or "https") || string.IsNullOrEmpty(url.Host) || !string.IsNullOrEmpty(url.UserInfo))) return null;
        if (content.Ingredients.Any(i => i is null || i.Id == Guid.Empty || Text(i.Name) is not { Length: <= 200 }
            || Text(i.Unit)?.Length > 50 || Text(i.QuantityText)?.Length > 100
            || i.Quantity is < 0 or > 1000000 || i.Quantity is { } q && decimal.Round(q, 4) != q
            || i.Quantity is not null && Text(i.QuantityText) is not null)
            || content.Ingredients.Select(i => i.Id).Distinct().Count() != content.Ingredients.Length
            || content.Steps.Any(s => Text(s) is not { Length: <= 2000 })) return null;
        return new(title, content.DefaultServings,
            content.Ingredients.Select(i => i with { Name = i.Name.Trim(), QuantityText = Text(i.QuantityText), Unit = Text(i.Unit) }).ToArray(),
            content.Steps.Select(s => s.Trim()).ToArray(), Text(content.SourceUrl), Text(content.Notes));
    }
    private static async Task<RecipesResponse> Response(WheelhouseDbContext db, CancellationToken ct, bool canManage = true)
    {
        var revision = await db.Families.Select(f => f.MealsChangeNumber).SingleAsync(ct);
        var recipes = await db.Recipes.AsNoTracking().OrderBy(r => r.Id).ToArrayAsync(ct);
        return new(revision, recipes.Select(r => new RecipeResponse(r.Id, r.Version, r.Archived, RecipeJson.Read<RecipeContent>(r.Content))).ToArray(), canManage);
    }
    private static async Task<IResult> Read(ClaimsPrincipal user, WheelhouseDbContext db, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var result = await Response(db, ct, user.HasClaim(WheelhouseClaims.Role, Roles.Parent)); await tx.CommitAsync(ct); return Results.Ok(result);
    }
    private static async Task<IResult> Save(Guid id, SaveRecipe request, WheelhouseDbContext db, CancellationToken ct)
    {
        var content = Normalize(request.Content);
        if (id == Guid.Empty || request.CommandId == Guid.Empty || content is null)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["recipe"] = ["Enter a title, 1–100 servings, 1–100 ingredients and preparation steps. Use decimal quantities or text, and an optional http(s) source URL."] });
        var fingerprint = RecipeJson.Write(new { kind = "recipe", id, request.Version, request.Archived, content });
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({db.CurrentFamilyId!.Value.ToString()}, 61))", ct);
        var receipt = await db.MealCommands.SingleOrDefaultAsync(c => c.Id == request.CommandId, ct);
        if (receipt is not null && receipt.Request != fingerprint) return Results.Conflict(new { message = "This save ID belongs to another request." });
        if (receipt is null)
        {
            var row = await db.Recipes.SingleOrDefaultAsync(r => r.Id == id, ct);
            if (row?.Version != request.Version || row is null && request.Archived) return Results.Conflict(await Response(db, ct));
            var json = RecipeJson.Write(content);
            if (row is null)
            {
                row = new Recipe { Id = id, FamilyId = db.CurrentFamilyId!.Value, Content = json };
                db.Recipes.Add(row);
            }
            else if (row.Content != json || row.Archived != request.Archived)
            { row.Content = json; row.Archived = request.Archived; row.Version = Guid.NewGuid(); }
            db.MealCommands.Add(new MealCommand { Id = request.CommandId, FamilyId = db.CurrentFamilyId!.Value, Request = fingerprint });
            await db.SaveChangesAsync(ct);
        }
        var result = await Response(db, ct); await tx.CommitAsync(ct); return Results.Ok(result);
    }
}
