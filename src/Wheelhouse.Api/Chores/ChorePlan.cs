using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Chores;

/// <summary>Immutable for days already reached. A parent changes the version effective tomorrow.</summary>
public sealed class ChorePlan : IFamilyOwned
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid FamilyId { get; set; }
    public Guid ChoreId { get; set; }
    public DateOnly EffectiveFrom { get; set; }
    public required string Title { get; set; }
    public string? Notes { get; set; }
    public Guid? MemberId { get; set; }
    public DateOnly StartsOn { get; set; }
    public DateOnly? EndsOn { get; set; }
    public required string Frequency { get; set; }
    public int IntervalWeeks { get; set; } = 1;
    public int WeekdaysMask { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();

}

/// <summary>Only written on a completion command; GET never creates occurrence rows.</summary>
public sealed class ChoreCompletion : IFamilyOwned
{
    public Guid FamilyId { get; set; }
    public Guid ChoreId { get; set; }
    public DateOnly DueDate { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
}
