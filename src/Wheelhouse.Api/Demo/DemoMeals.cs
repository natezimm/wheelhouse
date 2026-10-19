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

        void Add(DateOnly date, string slot, string title, string? notes) => family.Meals.Add(new MealSlot
        { Id = Guid.CreateVersion7(), FamilyId = family.Id, Date = date, Slot = slot, Title = title, Notes = notes });
    }
}
