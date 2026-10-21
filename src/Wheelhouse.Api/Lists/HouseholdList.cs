using Wheelhouse.Api.Data;
using Wheelhouse.Api.Meals;

namespace Wheelhouse.Api.Lists;

public sealed class HouseholdList : IFamilyOwned
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid CreationId { get; set; }
    public required string CreationRequest { get; set; }
    public required string Name { get; set; }
    public bool Archived { get; set; }
    public bool IsGrocery { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
    public List<ListItem> Items { get; } = [];
    public List<GroceryCategory> Categories { get; } = [];
}

public sealed class ListItem : IFamilyOwned
{
    public List<GroceryContribution> Contributions { get; } = [];
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid HouseholdListId { get; set; }
    public Guid CreationId { get; set; }
    public required string CreationRequest { get; set; }
    public required string Text { get; set; }
    public string? Notes { get; set; }
    public string? Quantity { get; set; }
    public bool QuantityIsText { get; set; }
    public string? Unit { get; set; }
    public Guid? CategoryId { get; set; }
    public bool Checked { get; set; }
    public bool Deleted { get; set; }
    public long SortOrder { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
}

public sealed class GroceryCategory : IFamilyOwned
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid HouseholdListId { get; set; }
    public required string Name { get; set; }
    public int SortOrder { get; set; }
    public bool IsOther { get; set; }
}
