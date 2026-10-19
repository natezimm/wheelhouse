using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Lists;

public sealed class HouseholdList : IFamilyOwned
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid CreationId { get; set; }
    public required string CreationRequest { get; set; }
    public required string Name { get; set; }
    public bool Archived { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
    public List<ListItem> Items { get; } = [];
}

public sealed class ListItem : IFamilyOwned
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid HouseholdListId { get; set; }
    public Guid CreationId { get; set; }
    public required string CreationRequest { get; set; }
    public required string Text { get; set; }
    public string? Notes { get; set; }
    public bool Checked { get; set; }
    public bool Deleted { get; set; }
    public long SortOrder { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
}

public sealed record ListsResponse(long ChangeNumber, HouseholdListResponse[] Lists);
public sealed record HouseholdListResponse(Guid Id, Guid CreationId, string Name, bool Archived, Guid Version, ListItemResponse[] Items)
{
    public static HouseholdListResponse From(HouseholdList list) => new(list.Id, list.CreationId, list.Name, list.Archived,
        list.Version, list.Items.Where(i => !i.Deleted).OrderBy(i => i.SortOrder).ThenBy(i => i.Id).Select(ListItemResponse.From).ToArray());
}
public sealed record ListItemResponse(Guid Id, Guid CreationId, string Text, string? Notes, bool Checked, bool Deleted, long SortOrder, Guid Version)
{
    public static ListItemResponse From(ListItem i) => new(i.Id, i.CreationId, i.Text, i.Notes, i.Checked, i.Deleted, i.SortOrder, i.Version);
}
public sealed record CreateList(Guid CreationId, string Name);
public sealed record RenameList(Guid Version, string Name);
public sealed record ListVersion(Guid Version);
public sealed record CreateListItem(Guid CreationId, string Text, string? Notes);
public sealed record EditListItem(Guid Version, string Text, string? Notes);
public sealed record CheckListItem(Guid Version, bool Checked);
public sealed record MoveListItem(Guid Version, Guid ListVersion, int Direction);
