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
