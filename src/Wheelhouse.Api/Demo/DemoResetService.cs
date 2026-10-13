using Microsoft.Extensions.Options;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Demo;

/// <summary>On a demo instance, resets the demo family every night. Does nothing otherwise.</summary>
internal sealed class DemoResetService(
    IServiceScopeFactory scopes,
    IOptions<InstanceOptions> instance,
    TimeProvider time,
    ILogger<DemoResetService> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (instance.Value.Mode != InstanceMode.Demo)
        {
            return;
        }

        var zone = TimeZoneInfo.FindSystemTimeZoneById(DemoFamily.TimeZone);

        while (!stoppingToken.IsCancellationRequested)
        {
            var now = time.GetUtcNow();
            var next = NightlySchedule.NextRun(now, zone, DemoFamily.ResetsAt);
            await Task.Delay(next - now, time, stoppingToken);

            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<DemoSeeder>().ResetAsync(stoppingToken);
                logger.LogInformation("Reset the demo family");
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // A failed reset must not stop tomorrow's: log it and wait for the next night.
                logger.LogError(exception, "Could not reset the demo family");
            }
        }
    }
}
