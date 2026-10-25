using Microsoft.AspNetCore.SignalR;
using Wheelhouse.Api.Auth;

namespace Wheelhouse.Api.Calendar;

/// <summary>A hint to read the calendar again, not an event payload or a delta to apply.</summary>
public sealed record CalendarChanged(long ChangeNumber);

public interface ICalendarClient
{
    Task CalendarChanged(CalendarChanged change);
}

/// <summary>
/// A server-to-client subscription. The family comes only from the sign-in cookie; there are
/// deliberately no methods for choosing a family, joining a group or changing calendar data.
/// The first notification supplies the current committed number, including after reconnect.
/// </summary>
public sealed class CalendarHub(CalendarConnections connections) : Hub<ICalendarClient>
{
    public const string Path = "/hubs/calendar";

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

public static class CalendarLiveSetup
{
    public static IServiceCollection AddCalendarLive(this IServiceCollection services)
    {
        services.AddSignalR();
        services.AddOptions<CalendarLiveOptions>().BindConfiguration("CalendarLive");
        services.AddSingleton<CalendarConnections>();
        services.AddHostedService<CalendarLiveService>();
        return services;
    }

    public static IEndpointRouteBuilder MapCalendarLive(this IEndpointRouteBuilder app)
    {
        app.MapHub<CalendarHub>(CalendarHub.Path, options => options.CloseOnAuthenticationExpiration = true)
            .RequireAuthorization(Policies.Family);
        return app;
    }
}
