using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Devices;

/// <summary>
/// A paired wall display. Phones are not devices: parents sign in with Google. A display is
/// signed in by the same cookie as everyone else, carrying this row's id, so removing the row
/// signs the display out on its next request.
/// </summary>
public sealed class Device : IFamilyOwned
{
    /// <summary>How long a display stays signed in without being seen. Each visit extends it.</summary>
    public static readonly TimeSpan SignInLifetime = TimeSpan.FromDays(365);

    public Guid Id { get; set; }

    public Guid FamilyId { get; set; }

    /// <summary>What the parents call it, such as "Kitchen wall".</summary>
    public required string Name { get; set; }

    public DateTimeOffset PairedAt { get; set; }

    /// <summary>When the display last made a request, to the minute.</summary>
    public DateTimeOffset? LastSeenAt { get; set; }
}
