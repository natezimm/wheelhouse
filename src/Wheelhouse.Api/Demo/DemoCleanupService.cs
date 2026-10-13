using Microsoft.Extensions.Options;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Demo;

/// <summary>On a demo instance, deletes expired visitor copies every hour. Does nothing otherwise.</summary>
internal sealed class DemoCleanupService(
    IServiceScopeFactory scopes,
    IOptions<InstanceOptions> instance,
    TimeProvider time,
    ILogger<DemoCleanupService> logger)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (instance.Value.Mode != InstanceMode.Demo)
        {
            return;
        }

        using var timer = new PeriodicTimer(Interval, time);
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var deleted = await scope.ServiceProvider.GetRequiredService<DemoCopies>().DeleteExpiredAsync(stoppingToken);
                if (deleted > 0)
                {
                    logger.LogInformation("Deleted {Count} expired demo copies", deleted);
                }
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // A failed pass must not stop the next one: log it and wait for the next hour.
                logger.LogError(exception, "Could not delete expired demo copies");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
