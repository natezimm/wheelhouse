using Wheelhouse.Api.Data;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Auth;

/// <summary>
/// A parent's Google account, used for identity only: it says which member is signing in.
/// Kids have none. Removing the member removes the account, and with it their sign-in.
/// </summary>
public sealed class UserAccount : IFamilyOwned
{
    public Guid Id { get; set; }

    public Guid FamilyId { get; set; }

    public Guid MemberId { get; set; }

    public Member Member { get; set; } = null!;

    /// <summary>Google's stable id for the account (the <c>sub</c> claim). Unlike the email, it never changes.</summary>
    public required string GoogleSubject { get; set; }

    /// <summary>The account's email as of its last sign-in; it must still be on the instance's parent list.</summary>
    public required string Email { get; set; }
}
