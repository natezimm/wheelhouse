using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Chores;

public sealed class Chore : IFamilyOwned
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid CreationId { get; set; }
    public required string CreationRequest { get; set; }
    public required string Title { get; set; }
    public string? Notes { get; set; }
    public Guid? MemberId { get; set; }
    public DateOnly DueDate { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public bool Archived { get; set; }
    public DateOnly? ArchivedFrom { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
    public List<ChorePlan> Plans { get; } = [];
    public List<ChoreCompletion> Completions { get; } = [];
}
