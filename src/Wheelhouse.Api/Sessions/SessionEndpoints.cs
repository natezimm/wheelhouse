using System.Security.Claims;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Ai;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Sessions;

public static class SessionEndpoints
{
    /// <summary>
    /// Open to everyone: tells the web app what kind of instance this is, whether the visitor
    /// is signed in, and whether a parent can sign in with Google here, so it can show the demo
    /// notice, the sign-in button or the private screen. A paired display is signed in but is not
    /// a parent, so Settings says so instead of offering what only a parent may change.
    /// </summary>
    public static IEndpointRouteBuilder MapSession(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/session", (ClaimsPrincipal user, IOptions<InstanceOptions> instance, IOptions<GoogleSignInOptions> google, IOptionsMonitor<AiOptions> ai) =>
        {
            var signedIn = user.HasClaim(claim => claim.Type == WheelhouseClaims.Family);
            var display = user.HasClaim(claim => claim.Type == WheelhouseClaims.Device);
            // The AI features are for parents on an instance that has them on. Said before signing in
            // too, since a demo visitor asks for the session before checking in.
            var asks = !display && ai.CurrentValue.IsAvailable;
            return new SessionResponse(
                instance.Value.Mode,
                SignedIn: signedIn,
                CanSignIn: instance.Value.Mode == InstanceMode.Family && google.Value.IsConfigured,
                IsDisplay: display,
                Ai: new AiFeatures(Describe: asks, Ask: asks));
        })
            .AllowAnonymous();

        return app;
    }
}

public sealed record SessionResponse(InstanceMode Mode, bool SignedIn, bool CanSignIn, bool IsDisplay = false, AiFeatures? Ai = null);

/// <summary>Which AI features this visitor can use, so the screens show only those that work.</summary>
public sealed record AiFeatures(bool Describe, bool Ask);
