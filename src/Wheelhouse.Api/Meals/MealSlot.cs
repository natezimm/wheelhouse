using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Meals;

public sealed class MealSlot : IFamilyOwned
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public DateOnly Date { get; set; }
    public required string Slot { get; set; }
    public string? Title { get; set; }
    public string? Notes { get; set; }
    public string? RecipeData { get; set; }
    public int? Servings { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
}

// Receipts are internal idempotency records, not visible meal changes.
public sealed class MealCommand : IFamilyOwned
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public required string Request { get; set; }
}

public sealed record MealResponse(DateOnly Date, string Slot, string? Title, string? Notes, Guid? Version, RecipeSnapshot? Recipe = null, int? Servings = null);
public sealed record MealsResponse(DateOnly From, DateOnly To, long ChangeNumber, MealResponse[] Meals);
public sealed record SaveMeal(Guid CommandId, Guid? Version, string? Title, string? Notes, RecipeChoice? Recipe = null, int? Servings = null, bool RemoveRecipe = false);
public sealed record CopyChoice(DateOnly Date, string Slot, Guid SourceVersion, Guid? TargetVersion);
public sealed record CopyMeals(Guid CommandId, DateOnly SourceFrom, DateOnly TargetFrom, CopyChoice[] Items);
