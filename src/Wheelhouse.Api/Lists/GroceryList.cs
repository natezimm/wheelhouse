namespace Wheelhouse.Api.Lists;

public static class GroceryList
{
    public static readonly string[] DefaultCategories = ["Produce", "Dairy", "Meat & fish", "Pantry", "Frozen", "Other"];
    public static HouseholdList Create(Guid familyId)
    {
        var list = new HouseholdList { Id = Guid.CreateVersion7(), FamilyId = familyId, CreationId = Guid.NewGuid(),
            CreationRequest = "protected-grocery", Name = "Grocery", IsGrocery = true };
        foreach (var name in DefaultCategories)
            list.Categories.Add(new GroceryCategory { Id = Guid.CreateVersion7(), FamilyId = familyId, HouseholdListId = list.Id,
                Name = name, SortOrder = list.Categories.Count, IsOther = name == "Other" });
        return list;
    }
}
