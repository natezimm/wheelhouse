using Wheelhouse.Api.Families;
using Wheelhouse.Api.Lists;

namespace Wheelhouse.Api.Demo;

public static class DemoLists
{
    public static void AddTo(Family family)
    {
        var grocery = GroceryList.Create(family.Id);
        family.Lists.Add(grocery);
        Grocery("Apples", "6", null, "Produce");
        Grocery("Milk", "1", "carton", "Dairy");
        Grocery("Pasta", "2", "boxes", "Pantry");
        Grocery("Bread", null, null, "Other", true);
        Grocery("Something for lunch", null, null, "Other");
        void Grocery(string text, string? quantity, string? unit, string category, bool done = false) =>
            grocery.Items.Add(new ListItem { Id = Guid.CreateVersion7(), FamilyId = family.Id, HouseholdListId = grocery.Id,
                CreationId = Guid.NewGuid(), CreationRequest = "demo", Text = text, Quantity = quantity, Unit = unit,
                CategoryId = grocery.Categories.Single(c => c.Name == category).Id, Checked = done, SortOrder = grocery.Items.Count });

        Add("Errands", [("Return library books", "Leave them by the door", false), ("Pick up bike lights", null, false), ("Post birthday card", null, true)]);
        Add("Weekend packing", [("Rain jackets", null, false), ("Water bottles", "One for everyone", false), ("Board game", null, true)]);
        Add("Household to-dos", [("Measure the hallway shelf", null, false), ("Choose herb pots", null, false)]);

        void Add(string name, (string text, string? notes, bool done)[] rows)
        {
            var list = new HouseholdList { Id = Guid.CreateVersion7(), FamilyId = family.Id, CreationId = Guid.NewGuid(), CreationRequest = name, Name = name };
            foreach (var (text, notes, done) in rows)
                list.Items.Add(new ListItem { Id = Guid.CreateVersion7(), FamilyId = family.Id, HouseholdListId = list.Id,
                    CreationId = Guid.NewGuid(), CreationRequest = "demo", Text = text, Notes = notes, Checked = done, SortOrder = list.Items.Count });
            family.Lists.Add(list);
        }
    }
}
