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
