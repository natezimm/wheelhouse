using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Families;

/// <summary>A person in the family. Their color identifies them on every screen.</summary>
public sealed class Member : IFamilyOwned
{
    public Guid Id { get; set; }

    public Guid FamilyId { get; set; }

    public required string DisplayName { get; set; }

    /// <summary>Hex color such as <c>#2F5FC4</c>.</summary>
    public required string Color { get; set; }

    /// <summary>The letter shown in the member's avatar.</summary>
    public required string Initial { get; set; }

    /// <summary>A built-in picture from <see cref="MemberAvatars"/> shown instead of the initial, or null.</summary>
    public string? Avatar { get; set; }

    public MemberRole Role { get; set; }

    public int SortOrder { get; set; }
}

public enum MemberRole
{
    Parent,

    /// <summary>A profile only: kids have no sign-in.</summary>
    Kid,
}
