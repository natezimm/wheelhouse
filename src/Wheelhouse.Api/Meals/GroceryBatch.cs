using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Meals;

public sealed class GroceryBatch : IFamilyOwned
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public required string Request { get; set; }
    public required string Result { get; set; }
}
public sealed class GroceryContribution : IFamilyOwned
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid ListItemId { get; set; }
    public DateOnly Date { get; set; }
    public required string Slot { get; set; }
    public required string SnapshotKey { get; set; }
    public Guid IngredientId { get; set; }
    public required string SourceData { get; set; }
}
