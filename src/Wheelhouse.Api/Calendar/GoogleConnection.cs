using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Calendar;

/// <summary>
/// The family's one shared Google account, connected once by a parent with Calendar access.
/// The API keeps only its refresh token, encrypted, and asks Google for short-lived access
/// tokens as it needs them. A family has at most one; the demo never has any.
/// </summary>
public sealed class GoogleConnection : IFamilyOwned
{
    public Guid Id { get; set; }

    public Guid FamilyId { get; set; }

    /// <summary>The shared account's address, so the parents can see which account is connected.</summary>
    public required string Email { get; set; }

    /// <summary>The refresh token, encrypted with ASP.NET Core Data Protection (see <see cref="GoogleTokens"/>).</summary>
    public required string EncryptedRefreshToken { get; set; }

    /// <summary>The scopes Google granted, separated by spaces.</summary>
    public required string Scopes { get; set; }

    public GoogleConnectionStatus Status { get; set; } = GoogleConnectionStatus.Connected;

    public DateTimeOffset ConnectedAt { get; set; }
}

public enum GoogleConnectionStatus
{
    Connected,

    /// <summary>
    /// Google refused the refresh token: the account removed the app's access, changed its
    /// password, or the grant expired. A parent has to connect again.
    /// </summary>
    NeedsReauth,
}
