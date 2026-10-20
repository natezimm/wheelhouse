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
    public string? Unit { get; set; }
    public Guid? CategoryId { get; set; }
    public bool Checked { get; set; }
    public bool Deleted { get; set; }
    public long SortOrder { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
}

public sealed record ListsResponse(long ChangeNumber, HouseholdListResponse[] Lists);
public sealed record HouseholdListResponse(Guid Id, Guid CreationId, string Name, bool Archived, Guid Version, ListItemResponse[] Items,
    bool IsGrocery = false, GroceryCategoryResponse[]? Categories = null)
{
    public static HouseholdListResponse From(HouseholdList list) => new(list.Id, list.CreationId, list.Name, list.Archived,
        list.Version, list.Items.Where(i => !i.Deleted).OrderBy(i => i.SortOrder).ThenBy(i => i.Id).Select(ListItemResponse.From).ToArray(),
        list.IsGrocery, list.Categories.OrderBy(c => c.SortOrder).ThenBy(c => c.Id).Select(c => new GroceryCategoryResponse(c.Id, c.Name, c.IsOther)).ToArray());
}
public sealed record ListItemResponse(Guid Id, Guid CreationId, string Text, string? Notes, bool Checked, bool Deleted, long SortOrder, Guid Version,
    string? Quantity = null, string? Unit = null, Guid? CategoryId = null, GroceryOrigin[]? Sources = null)
{
    public static ListItemResponse From(ListItem i) => new(i.Id, i.CreationId, i.Text, i.Notes, i.Checked, i.Deleted, i.SortOrder, i.Version, i.Quantity, i.Unit, i.CategoryId,
        i.Contributions.OrderBy(c=>c.Id).Select(c=>RecipeJson.Read<GroceryOrigin>(c.SourceData)).ToArray());
}
public sealed record CreateList(Guid CreationId, string Name);
public sealed record RenameList(Guid Version, string Name);
public sealed record ListVersion(Guid Version);
public sealed record CreateListItem(Guid CreationId, string Text, string? Notes, string? Quantity = null, string? Unit = null, Guid? CategoryId = null);
public sealed record EditListItem(Guid Version, string Text, string? Notes, string? Quantity = null, string? Unit = null, Guid? CategoryId = null);
public sealed record CheckListItem(Guid Version, bool Checked);
public sealed record MoveListItem(Guid Version, Guid ListVersion, int Direction);

public sealed class GroceryCategory : IFamilyOwned
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid HouseholdListId { get; set; }
    public required string Name { get; set; }
    public int SortOrder { get; set; }
    public bool IsOther { get; set; }
}
public sealed record GroceryCategoryResponse(Guid Id, string Name, bool IsOther);
public sealed record CategoryDraft(Guid Id, string Name);
public sealed record EditCategories(Guid Version, CategoryDraft[] Categories);
public sealed record ReviewedItem(Guid Id, Guid Version);
public sealed record ClearCheckedItems(ReviewedItem[] Items);
