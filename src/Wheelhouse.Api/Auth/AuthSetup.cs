using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;

namespace Wheelhouse.Api.Auth;

public static class WheelhouseClaims
{
    /// <summary>The id of the family the signed-in person or device belongs to.</summary>
    public const string Family = "wheelhouse:family";

    public const string Role = "wheelhouse:role";

    /// <summary>A parent's <see cref="UserAccount"/> id. Demo visitors have none.</summary>
    public const string Account = "wheelhouse:account";
}

public static class Roles
{
    public const string Parent = "parent";
}

public static class Policies
{
    /// <summary>Anyone signed in to a family: a parent, or later a paired display.</summary>
    public const string Family = "Family";

    /// <summary>A parent. Needed for settings and anything that manages the family.</summary>
    public const string Parent = "Parent";
}

public static class WheelhousePrincipal
{
    /// <summary>
    /// The identity the sign-in cookie carries for a parent of <paramref name="familyId"/>: a
    /// demo visitor, or a parent signed in with Google as <paramref name="accountId"/>.
    /// </summary>
    public static ClaimsPrincipal Parent(Guid familyId, Guid? accountId = null)
    {
        List<Claim> claims =
        [
            new(WheelhouseClaims.Family, familyId.ToString()),
            new(WheelhouseClaims.Role, Roles.Parent),
        ];
        if (accountId is { } account)
        {
            claims.Add(new(WheelhouseClaims.Account, account.ToString()));
        }

        return new(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
    }
}

public static class AuthSetup
{
    /// <summary>
    /// Everyone is authenticated by the same encrypted, HTTP-only cookie. What differs is how it
    /// is issued: a demo instance hands one to each visitor for their private copy, and a family
    /// instance hands one only to a parent who signed in with Google.
    /// </summary>
    public static IServiceCollection AddWheelhouseAuth(this IServiceCollection services)
    {
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentFamily, HttpCurrentFamily>();
        services.AddScoped<ParentSignIn>();
        services.AddOptions<GoogleSignInOptions>().BindConfiguration(GoogleSignInOptions.Section);

        services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
            .AddCookie(options =>
            {
                options.Cookie.Name = "wheelhouse";
                // Lax keeps the cookie off cross-site POST, PUT and DELETE requests, so another
                // site cannot change a family through a signed-in visitor's browser.
                options.Cookie.SameSite = SameSiteMode.Lax;
                // HTTPS-only whenever the visitor came over HTTPS, which the server's nginx reports
                // in X-Forwarded-Proto (see Program.cs). Plain HTTP on localhost keeps working.
                options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                // This is an API: answer with a status code, never a redirect to a login page.
                options.Events.OnRedirectToLogin = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                };
                options.Events.OnRedirectToAccessDenied = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return Task.CompletedTask;
                };
                // A parent's cookie stops working as soon as they are removed from the family
                // or from the instance's parent list, not only when it expires.
                options.Events.OnValidatePrincipal = async context =>
                {
                    if (context.Principal?.FindFirstValue(WheelhouseClaims.Account) is not { } account)
                    {
                        return;
                    }

                    var signIn = context.HttpContext.RequestServices.GetRequiredService<ParentSignIn>();
                    if (!Guid.TryParse(account, out var accountId)
                        || !await signIn.IsStillAllowedAsync(accountId, context.HttpContext.RequestAborted))
                    {
                        context.RejectPrincipal();
                        await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                    }
                };
            })
            .AddGoogle(options =>
            {
                // Under /api so the web container forwards Google's redirect back to the API.
                options.CallbackPath = "/api/auth/google/callback";
                options.SignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
                options.ClaimActions.MapCustomJson("email_verified", user =>
                    user.TryGetProperty("email_verified", out var verified) && verified.ValueKind == JsonValueKind.True
                        ? "true"
                        : "false");
                options.Events.OnRedirectToAuthorizationEndpoint = context =>
                {
                    // Always ask which account, so a phone signed in to several picks the right one.
                    context.Response.Redirect(context.RedirectUri + "&prompt=select_account");
                    return Task.CompletedTask;
                };
                options.Events.OnTicketReceived = async context =>
                {
                    var signIn = context.HttpContext.RequestServices.GetRequiredService<ParentSignIn>();
                    context.Properties!.Items.TryGetValue(GoogleSignIn.TimeZoneItem, out var timeZone);
                    var principal = await signIn.SignInAsync(
                        GoogleSignIn.IdentityOf(context.Principal!), timeZone, context.HttpContext.RequestAborted);

                    if (principal is null)
                    {
                        context.Response.Redirect("/?signin=refused");
                        context.HandleResponse();
                        return;
                    }

                    // The cookie carries only the family, the role and the account, never Google's claims.
                    context.Principal = principal;
                    context.Properties.IsPersistent = true;
                };
                options.Events.OnRemoteFailure = context =>
                {
                    // Cancelled on Google's screen, or the round trip went stale: back to the app.
                    context.Response.Redirect("/?signin=failed");
                    context.HandleResponse();
                    return Task.CompletedTask;
                };
            });

        // The client is read when the handler is first built, not here, so the integration tests'
        // settings apply. Without one (the demo, local development) the handler still needs
        // placeholder values to start; the sign-in endpoint refuses to use it.
        services.AddOptions<GoogleOptions>(GoogleDefaults.AuthenticationScheme)
            .Configure<IOptions<GoogleSignInOptions>>((options, google) =>
            {
                options.ClientId = google.Value.IsConfigured ? google.Value.ClientId! : "not-configured";
                options.ClientSecret = google.Value.IsConfigured ? google.Value.ClientSecret! : "not-configured";
            });

        var family = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .RequireClaim(WheelhouseClaims.Family)
            .Build();

        services.AddAuthorizationBuilder()
            .AddPolicy(Policies.Family, family)
            // An endpoint that names no policy is not open by accident: it needs a family sign-in.
            // The few open endpoints say so with AllowAnonymous().
            .SetFallbackPolicy(family)
            .AddPolicy(Policies.Parent, policy => policy
                .RequireAuthenticatedUser()
                .RequireClaim(WheelhouseClaims.Family)
                .RequireClaim(WheelhouseClaims.Role, Roles.Parent));

        return services;
    }
}
