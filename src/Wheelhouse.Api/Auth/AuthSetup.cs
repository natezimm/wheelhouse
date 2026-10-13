using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;

namespace Wheelhouse.Api.Auth;

public static class WheelhouseClaims
{
    /// <summary>The id of the family the signed-in person or device belongs to.</summary>
    public const string Family = "wheelhouse:family";

    public const string Role = "wheelhouse:role";
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
    /// <summary>The identity the sign-in cookie carries for a parent of <paramref name="familyId"/>.</summary>
    public static ClaimsPrincipal Parent(Guid familyId) => new(new ClaimsIdentity(
        [
            new Claim(WheelhouseClaims.Family, familyId.ToString()),
            new Claim(WheelhouseClaims.Role, Roles.Parent),
        ],
        CookieAuthenticationDefaults.AuthenticationScheme));
}

public static class AuthSetup
{
    /// <summary>
    /// Everyone is authenticated by the same encrypted, HTTP-only cookie. What differs is how it
    /// is issued: a demo instance hands one to each visitor for their private copy, and a family
    /// instance will hand one out only after sign-in.
    /// </summary>
    public static IServiceCollection AddWheelhouseAuth(this IServiceCollection services)
    {
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentFamily, HttpCurrentFamily>();

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
