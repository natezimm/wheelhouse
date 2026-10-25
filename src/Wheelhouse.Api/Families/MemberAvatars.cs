namespace Wheelhouse.Api.Families;

/// <summary>
/// The built-in pictures a member can choose. Each is drawn in <c>web/public/avatars/{id}.svg</c>,
/// and the web app lists the same ids in <c>core/avatars.ts</c>.
/// </summary>
public static class MemberAvatars
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        "fox", "cat", "dog", "bear", "panda", "koala", "bunny", "lion",
        "tiger", "owl", "penguin", "frog", "monkey", "unicorn", "dino", "robot",
    };
}
