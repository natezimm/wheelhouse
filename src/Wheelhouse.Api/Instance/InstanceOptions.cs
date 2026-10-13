namespace Wheelhouse.Api.Instance;

/// <summary>What kind of Wheelhouse this deployment is. Bound from the <c>Wheelhouse</c> section.</summary>
public sealed class InstanceOptions
{
    public const string Section = "Wheelhouse";

    /// <summary>Defaults to <see cref="InstanceMode.Family"/>, so an unconfigured instance is private.</summary>
    public InstanceMode Mode { get; set; } = InstanceMode.Family;
}

public enum InstanceMode
{
    /// <summary>A real family's instance. Nothing is readable without signing in.</summary>
    Family,

    /// <summary>The public demo: a fictional family that every visitor sees, reset nightly.</summary>
    Demo,
}
