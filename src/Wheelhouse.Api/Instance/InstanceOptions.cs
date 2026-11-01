namespace Wheelhouse.Api.Instance;

/// <summary>What kind of Wheelhouse this deployment is. Bound from the <c>Wheelhouse</c> section.</summary>
public sealed class InstanceOptions
{
    public const string Section = "Wheelhouse";

    /// <summary>Defaults to <see cref="InstanceMode.Family"/>, so an unconfigured instance is private.</summary>
    public InstanceMode Mode { get; set; } = InstanceMode.Family;

    /// <summary>
    /// On a demo instance, the most visitor copies kept at once. Beyond it a new visitor's copy
    /// replaces the oldest, which bounds how much a script hammering the demo can store.
    /// </summary>
    public int MaxDemoCopies { get; set; } = 1000;

    /// <summary>
    /// On a demo instance, the most events one visitor's copy holds, counting each occurrence of a
    /// series. The fictional family starts with under a hundred, and a daily series adds at most
    /// about 490, since the demo keeps the same days as Google's sync window.
    /// </summary>
    public int MaxDemoEvents { get; set; } = 2000;

    /// <summary>
    /// On a family instance, the Google accounts allowed to sign in as parents, as email
    /// addresses separated by commas. Nobody else can sign in, and removing an address here
    /// signs that parent out on their next request.
    /// </summary>
    public string? ParentEmails { get; set; }

    public bool IsParentEmail(string email) =>
        (ParentEmails ?? "")
            .Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Contains(email.Trim(), StringComparer.OrdinalIgnoreCase);
}

public enum InstanceMode
{
    /// <summary>A real family's instance. Nothing is readable without signing in.</summary>
    Family,

    /// <summary>The public demo: every visitor gets a private copy of a fictional family, kept for a day.</summary>
    Demo,
}
