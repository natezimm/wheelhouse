using System.Text.Json;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Meals;

public sealed class Recipe : IFamilyOwned
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
    public bool Archived { get; set; }
    public required string Content { get; set; }
}

public sealed record Ingredient(Guid Id, string Name, decimal? Quantity, string? QuantityText, string? Unit)
{
    public Ingredient Scale(int servings, int defaultServings) => this with
    { Quantity = Quantity is { } number ? decimal.Round(number * servings / defaultServings, 4, MidpointRounding.AwayFromZero) : null };
}
public sealed record RecipeContent(string Title, int DefaultServings, Ingredient[] Ingredients, string[] Steps, string? SourceUrl, string? Notes);
public sealed record RecipeResponse(Guid Id, Guid Version, bool Archived, RecipeContent Content);
public sealed record RecipesResponse(long ChangeNumber, RecipeResponse[] Recipes, bool CanManage);
public sealed record SaveRecipe(Guid CommandId, Guid? Version, bool Archived, RecipeContent Content);
public sealed record RecipeChoice(Guid Id, Guid Version);
public sealed record RecipeSnapshot(Guid Id, Guid Version, RecipeContent Content);

public static class RecipeJson
{
    public static string Write<T>(T value) => JsonSerializer.Serialize(value);
    public static T Read<T>(string value) => JsonSerializer.Deserialize<T>(value)!;
}
