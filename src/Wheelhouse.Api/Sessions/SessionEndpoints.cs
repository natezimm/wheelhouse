using System.Security.Claims;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Sessions;

public static class SessionEndpoints
{
    /// <summary>
    /// Open to everyone: tells the web app what kind of instance this is, whether the visitor
    /// is signed in, and whether a parent can sign in with Google here, so it can show the demo
    /// notice, the sign-in button or the private screen.
    /// </summary>
    public static IEndpointRouteBuilder MapSession(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/session", (ClaimsPrincipal user, IOptions<InstanceOptions> instance, IOptions<GoogleSignInOptions> google) =>
            new SessionResponse(
                instance.Value.Mode,
                SignedIn: user.HasClaim(claim => claim.Type == WheelhouseClaims.Family),
                CanSignIn: instance.Value.Mode == InstanceMode.Family && google.Value.IsConfigured))
            .AllowAnonymous();

        return app;
    }
}

public sealed record SessionResponse(InstanceMode Mode, bool SignedIn, bool CanSignIn);
