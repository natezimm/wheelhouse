using Microsoft.AspNetCore.SignalR;
using Wheelhouse.Api.Auth;

namespace Wheelhouse.Api.Household;

/// <summary>A hint to read the household again, not an event payload or a delta to apply.</summary>
public sealed record HouseholdChanged(string Domain, long ChangeNumber);

public interface IHouseholdClient
{
    Task HouseholdChanged(HouseholdChanged change);
}

/// <summary>
/// A server-to-client subscription. The family comes only from the sign-in cookie; there are
/// deliberately no methods for choosing a family, joining a group or changing household data.
/// The first notification supplies the current committed number, including after reconnect.
/// </summary>
public sealed class HouseholdHub(HouseholdConnections connections) : Hub<IHouseholdClient>
{
    public const string Path = "/hubs/household";

    public override async Task OnConnectedAsync()
    {
        if (!await connections.AddAsync(Context, Context.ConnectionAborted))
        {
            Context.Abort();
            return;
        }

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await connections.RemoveAsync(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }
}

public static class HouseholdLiveSetup
{
    public static IServiceCollection AddHouseholdLive(this IServiceCollection services)
    {
        services.AddSignalR();
        services.AddOptions<HouseholdLiveOptions>().BindConfiguration("HouseholdLive");
        services.AddSingleton<HouseholdConnections>();
        services.AddHostedService<HouseholdLiveService>();
        return services;
    }

    public static IEndpointRouteBuilder MapHouseholdLive(this IEndpointRouteBuilder app)
    {
        app.MapHub<HouseholdHub>(HouseholdHub.Path, options => options.CloseOnAuthenticationExpiration = true)
            .RequireAuthorization(Policies.Family);
        return app;
    }

    /// <summary>Cookie-authenticated WebSockets need an Origin check in addition to HTTP CORS.</summary>
    public static IApplicationBuilder UseHouseholdHubOrigin(this IApplicationBuilder app) => app.Use(async (http, next) =>
    {
        if (http.Request.Path.StartsWithSegments(HouseholdHub.Path) && http.Request.Headers.Origin.Count > 0)
        {
            var origins = http.Request.Headers.Origin;
            if (origins.Count != 1
                || !Uri.TryCreate(origins[0], UriKind.Absolute, out var origin)
                || origin.PathAndQuery != "/" || origin.Fragment.Length > 0 || origin.UserInfo.Length > 0
                || !Uri.TryCreate($"{http.Request.Scheme}://{http.Request.Host}", UriKind.Absolute, out var site)
                || !string.Equals(origin.GetLeftPart(UriPartial.Authority), site.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase))
            {
                http.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }
        }

        // Nonbrowser clients may omit Origin; they still need the authenticated family cookie.
        await next(http);
    });
}

