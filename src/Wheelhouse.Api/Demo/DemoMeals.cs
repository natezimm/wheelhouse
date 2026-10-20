using Wheelhouse.Api.Families;
using Wheelhouse.Api.Meals;

namespace Wheelhouse.Api.Demo;

public static class DemoMeals
{
    public static void AddTo(Family family, DateTimeOffset createdAt)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(createdAt, TimeZoneInfo.FindSystemTimeZoneById(family.TimeZone)).DateTime);
        var start = today.AddDays(-(((int)today.DayOfWeek - (int)family.WeekStartsOn + 7) % 7));
        for (var day = 0; day < 7; day++)
        {
            Add(start.AddDays(day - 7), "Dinner", new[] { "Vegetable pasta", "Taco bowls", "Roast chicken", "Soup and bread", "Homemade pizza", "Salmon and rice", "Leftovers" }[day], "Previous week's plan");
            if (day % 2 == 0) Add(start.AddDays(day), "Dinner", new[] { "Pasta night", "Taco bowls", "Baked potatoes", "Soup", "Pizza night", "Rice bowls", "Roast vegetables" }[day], day == 0 ? "Use the tomatoes in the fridge" : null);
        }
        Add(today, "Breakfast", "Oatmeal and berries", null);
        Add(today, "Lunch", "Sandwiches and fruit", null);
        if (!family.Meals.Any(m => m.Date == today && m.Slot == "Dinner")) Add(today, "Dinner", "Chicken and rice", null);
        var content = new RecipeContent("Roasted tomato pasta", 4,
            [new(Guid.NewGuid(), "Pasta", 400m, null, "g"), new(Guid.NewGuid(), "Tomatoes", 600m, null, "g"),
             new(Guid.NewGuid(), "Olive oil", 2m, null, "tbsp"), new(Guid.NewGuid(), "Salt", null, "to taste", null)],
            ["Roast the tomatoes with olive oil for 25 minutes at 200°C / 400°F.",
             "Cook the pasta, toss with the tomatoes and season to taste."], null, "A Marlowe family weeknight favorite.");
        var recipe = new Recipe { Id = Guid.NewGuid(), FamilyId = family.Id, Content = RecipeJson.Write(content) };
        family.Recipes.Add(recipe);
        family.Recipes.Add(new Recipe { Id = Guid.NewGuid(), FamilyId = family.Id, Archived = true,
            Content = RecipeJson.Write(content with { Title = "Summer tomato pasta" }) });
        var planned = family.Meals.Single(m => m.Date == today && m.Slot == "Dinner");
        planned.Title = content.Title; planned.Servings = 6;
        planned.RecipeData = RecipeJson.Write(new RecipeSnapshot(recipe.Id, recipe.Version, content));
        // A prior purchase demonstrates durable source counts and incompatible manual units.
        var grocery=family.Lists.Single(l=>l.IsGrocery); var batchId=Guid.NewGuid();
        var item=new Wheelhouse.Api.Lists.ListItem {Id=Guid.CreateVersion7(),FamilyId=family.Id,HouseholdListId=grocery.Id,
            CreationId=Guid.NewGuid(),CreationRequest="demo meal groceries",Text="Pasta",Quantity="600",Unit="g",
            CategoryId=grocery.Categories.Single(c=>c.IsOther).Id,SortOrder=grocery.Items.Count};
        item.Contributions.Add(new GroceryContribution {Id=Guid.CreateVersion7(),FamilyId=family.Id,ListItemId=item.Id,
            Date=planned.Date,Slot=planned.Slot,SnapshotKey=GrocerySources.Key(planned),IngredientId=content.Ingredients[0].Id,
            SourceData=RecipeJson.Write(new GroceryOrigin(batchId,planned.Date,planned.Slot,planned.Title,"Pasta",recipe.Id,recipe.Version,6,600,null,"g"))});
        grocery.Items.Add(item);
        family.GroceryBatches.Add(new GroceryBatch {Id=batchId,FamilyId=family.Id,Request="demo",
            Result=RecipeJson.Write(new GroceryBatchResponse(batchId,createdAt,1,[item.Id]))});

        void Add(DateOnly date, string slot, string title, string? notes) => family.Meals.Add(new MealSlot
        { Id = Guid.CreateVersion7(), FamilyId = family.Id, Date = date, Slot = slot, Title = title, Notes = notes });
    }
}
