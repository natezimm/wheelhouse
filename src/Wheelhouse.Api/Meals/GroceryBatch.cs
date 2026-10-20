using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Lists;

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
public sealed record GroceryOrigin(Guid BatchId, DateOnly Date, string Slot, string MealTitle, string IngredientName,
    Guid RecipeId, Guid RecipeVersion, int Servings, decimal? Quantity, string? QuantityText, string? Unit);
public sealed record GroceryIngredient(Guid Id, string Name, decimal? Quantity, string? QuantityText, string? Unit, int PreviousCount);
public sealed record GroceryMeal(DateOnly Date, string Slot, Guid Version, string Title, string? SnapshotKey, int? Servings, GroceryIngredient[] Ingredients);
public sealed record GroceryPreview(DateOnly From, DateOnly To, long MealsChangeNumber, long ListsChangeNumber,
    HouseholdListResponse Grocery, GroceryMeal[] Meals);
public sealed record GroceryChoice(DateOnly Date, string Slot, Guid MealVersion, string SnapshotKey, Guid IngredientId,
    decimal? Quantity, string? QuantityText, int PreviousCount, bool AllowAdditional, Guid? TargetItemId = null, Guid? TargetVersion = null);
public sealed record AddMealGroceries(Guid CommandId, Guid GroceryListId, bool CombineNew, GroceryChoice[] Items);
public sealed record GroceryBatchResponse(Guid Id, DateTimeOffset AddedAt, int IngredientCount, Guid[] ItemIds);

public static class GrocerySources
{
    public static string Key(MealSlot meal) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        meal.RecipeData + "\n" + meal.Servings?.ToString(CultureInfo.InvariantCulture))));
    public static string Normalize(string? value) => string.Join(" ", (value ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).ToUpperInvariant();
    public static bool Number(string? value, out decimal quantity) => decimal.TryParse(value?.Trim(), NumberStyles.AllowDecimalPoint,
        CultureInfo.InvariantCulture, out quantity) && quantity is >= 0 and <= 1000000000000m;
    public static string Format(decimal value) => value.ToString("0.####", CultureInfo.InvariantCulture);
}
