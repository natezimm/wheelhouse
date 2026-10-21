using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Instance;
using Wheelhouse.Api.Calendar;

namespace Wheelhouse.Api.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuth(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth");

        auth.MapGet("google", SignInWithGoogle).AllowAnonymous();
        auth.MapPost("sign-out", async (HttpContext http, CalendarConnections calendar) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            await calendar.DisconnectAsync(http.User);
            return TypedResults.NoContent();
        });

        return app;
    }

    /// <summary>
    /// The phone's "Sign in with Google" link. It sends the browser to Google, which sends it
    /// back to <c>/api/auth/google/callback</c>; there <see cref="ParentSignIn"/> decides who
    /// gets in. Only a family instance with a Google client has it.
    /// </summary>
    private static Results<ChallengeHttpResult, NotFound> SignInWithGoogle(
        string? returnUrl,
        string? timeZone,
        IOptions<InstanceOptions> instance,
        IOptions<GoogleSignInOptions> google)
    {
        if (instance.Value.Mode != InstanceMode.Family || !google.Value.IsConfigured)
        {
            return TypedResults.NotFound();
        }

        var properties = new AuthenticationProperties { RedirectUri = IsLocal(returnUrl) ? returnUrl : "/" };
        if (!string.IsNullOrWhiteSpace(timeZone))
        {
            properties.Items[GoogleSignIn.TimeZoneItem] = timeZone;
        }

        return TypedResults.Challenge(properties, [GoogleDefaults.AuthenticationScheme]);
    }

    /// <summary>A path on this site, so sign-in can never be used to send someone elsewhere.</summary>
    private static bool IsLocal(string? url) =>
        url is ['/', ..] && !url.StartsWith("//") && !url.StartsWith("/\\");
}

public static class GoogleSignIn
{
    /// <summary>Carries the browser's time zone through Google's round trip, for a brand-new family.</summary>
    public const string TimeZoneItem = "wheelhouse:timeZone";

    /// <summary>Reads the claims the Google handler made from Google's user info.</summary>
    public static GoogleIdentity IdentityOf(ClaimsPrincipal google) => new(
        Subject: google.FindFirstValue(ClaimTypes.NameIdentifier) ?? "",
        Email: google.FindFirstValue(ClaimTypes.Email) ?? "",
        EmailVerified: google.FindFirstValue("email_verified") == "true",
        GivenName: google.FindFirstValue(ClaimTypes.GivenName),
        Name: google.FindFirstValue(ClaimTypes.Name));
}

