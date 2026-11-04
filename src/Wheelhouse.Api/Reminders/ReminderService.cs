using Microsoft.Extensions.Options;

namespace Wheelhouse.Api.Reminders;

public sealed class ReminderOptions
{
    public const string Section = "Reminders";

    /// <summary>The tests turn the worker off and run <see cref="ReminderSender"/> themselves.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>How often to look for events coming up: a reminder is at most this late.</summary>
    public TimeSpan Interval { get; set; } = TimeSpan.FromSeconds(30);
}

/// <summary>Sends the reminders that are due, every <see cref="ReminderOptions.Interval"/>, on the demo and family instances alike.</summary>
internal sealed class ReminderService(
    IServiceScopeFactory scopes,
    IOptions<ReminderOptions> options,
    TimeProvider time,
    ILogger<ReminderService> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
        {
            return;
        }

        using var timer = new PeriodicTimer(options.Value.Interval, time);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<ReminderSender>().SendDueAsync(stoppingToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
            {
                // A failed pass must not stop the next one.
                logger.LogError(exception, "Could not send reminders");
            }
        }
    }
}
