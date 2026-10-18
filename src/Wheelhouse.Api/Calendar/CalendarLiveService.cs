using Microsoft.Extensions.Options;

namespace Wheelhouse.Api.Calendar;

public sealed class CalendarLiveOptions
{
    /// <summary>Tests publish explicitly rather than race the timer.</summary>
    public bool Enabled { get; set; } = true;
}

/// <summary>
/// Publishes committed versions for connected families once a second. Polling the durable
/// revision also closes the commit/send crash gap without an outbox or coupling notifications
/// to a request's transaction. No subscribers means no database work. Each API process handles
/// its own sockets, including when a different process wrote the shared database.
/// </summary>
internal sealed class CalendarLiveService(CalendarConnections connections, IOptions<CalendarLiveOptions> options, TimeProvider time)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1), time);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await connections.PublishAsync(stoppingToken);
        }
    }
}
