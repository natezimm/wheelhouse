namespace Wheelhouse.Api.Devices;

/// <summary>
/// The code a wall display shows until a parent types it on their phone. It belongs to no
/// family until a parent claims it, so it is not family-owned and has no query filter.
/// </summary>
public sealed class PairingCode
{
    /// <summary>How long a code works, and how long the display then has to collect its sign-in.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    /// <summary>
    /// The display's private handle for asking whether it has been paired. Random, and only
    /// ever given to the display that asked for the code.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>Six digits, unique among the codes that still work.</summary>
    public required string Code { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>The display a parent created by entering this code. Null while it waits.</summary>
    public Guid? DeviceId { get; set; }
}
