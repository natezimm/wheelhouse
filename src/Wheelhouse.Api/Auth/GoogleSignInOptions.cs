namespace Wheelhouse.Api.Auth;

/// <summary>
/// The Google OAuth client parents sign in with, bound from the <c>Google</c> section. Only a
/// family instance uses it; the demo never calls Google.
/// </summary>
public sealed class GoogleSignInOptions
{
    public const string Section = "Google";

    public string? ClientId { get; set; }

    public string? ClientSecret { get; set; }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);
}
