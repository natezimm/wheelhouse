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
    public Guid Version { get; set; } = Guid.NewGuid();
}

public sealed record ChoreResponse(Guid Id, Guid CreationId, string Title, string? Notes, Guid? MemberId,
    DateOnly DueDate, DateTimeOffset? CompletedAt, bool Archived, Guid Version)
{
    public static ChoreResponse From(Chore chore) => new(chore.Id, chore.CreationId, chore.Title,
        chore.Notes, chore.MemberId, chore.DueDate, chore.CompletedAt, chore.Archived, chore.Version);
}

public sealed record ChoresResponse(long ChangeNumber, ChoreResponse[] Chores, bool CanManage);
public sealed record ChoreDraft(string Title, string? Notes, Guid? MemberId, DateOnly DueDate);
public sealed record CreateChore(Guid CreationId, string Title, string? Notes, Guid? MemberId, DateOnly DueDate);
public sealed record EditChore(Guid Version, string Title, string? Notes, Guid? MemberId, DateOnly DueDate);
public sealed record CompleteChore(Guid Version, bool Completed);
public sealed record ArchiveChore(Guid Version);
