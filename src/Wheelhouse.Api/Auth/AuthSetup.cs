using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Instance;

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

public static class AuthSetup
{
    private const string SchemeByMode = "Wheelhouse";

    /// <summary>
    /// A family instance authenticates with a cookie; the demo treats every visitor as a parent
    /// of the demo family. Which one applies is decided per request from the instance's mode.
    /// </summary>
    public static IServiceCollection AddWheelhouseAuth(this IServiceCollection services)
    {
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentFamily, HttpCurrentFamily>();

        services.AddAuthentication(SchemeByMode)
            .AddPolicyScheme(SchemeByMode, displayName: null, options =>
                options.ForwardDefaultSelector = context =>
                    context.RequestServices.GetRequiredService<IOptions<InstanceOptions>>().Value.Mode == InstanceMode.Demo
                        ? DemoAuthenticationHandler.SchemeName
                        : CookieAuthenticationDefaults.AuthenticationScheme)
            .AddCookie(options =>
            {
                options.Cookie.Name = "wheelhouse";
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
            })
            .AddScheme<AuthenticationSchemeOptions, DemoAuthenticationHandler>(DemoAuthenticationHandler.SchemeName, configureOptions: null);

        services.AddAuthorizationBuilder()
            .AddPolicy(Policies.Family, policy => policy
                .RequireAuthenticatedUser()
                .RequireClaim(WheelhouseClaims.Family))
            .AddPolicy(Policies.Parent, policy => policy
                .RequireAuthenticatedUser()
                .RequireClaim(WheelhouseClaims.Family)
                .RequireClaim(WheelhouseClaims.Role, Roles.Parent));

        return services;
    }
}
