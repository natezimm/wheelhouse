using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Ai;

/// <summary>
/// One UTC day's use of the model, for the whole instance. Not a family's row: the budget is the
/// instance's, so a demo visitor's many copies all draw on the same day.
/// </summary>
public sealed class AiUsage
{
    public DateOnly Day { get; set; }

    /// <summary>Input tokens plus <see cref="AiOptions.OutputWeight"/> times output tokens.</summary>
    public long Units { get; set; }

    /// <summary>Calls to the model, each step of a tool loop counted.</summary>
    public int Calls { get; set; }
}

/// <summary>
/// The instance's daily ceiling on the model (<see cref="AiOptions.DailyUnits"/>), kept in the database
/// so a restart or a second API process does not start the day again. Each call is let through while
/// the day has room and charged its usage once it answers, so the last call of a day can go over by
/// at most one call's worth (a few thousand units).
/// </summary>
public sealed class AiBudget(WheelhouseDbContext db, TimeProvider time, IOptionsMonitor<AiOptions> options)
{
    private DateOnly Today() => DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);

    /// <summary>Units spent today.</summary>
    public async Task<long> SpentAsync(CancellationToken cancellationToken)
    {
        var today = Today();
        return await db.AiUsage.AsNoTracking().Where(u => u.Day == today).Select(u => u.Units).FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<bool> HasRoomAsync(CancellationToken cancellationToken) =>
        await SpentAsync(cancellationToken) < options.CurrentValue.DailyUnits;

    /// <summary>The units one answer costs: input plus weighted output, or a set amount when it carries no usage.</summary>
    public static long UnitsOf(UsageDetails? usage) =>
        usage is { InputTokenCount: { } input, OutputTokenCount: { } output }
            ? input + AiOptions.OutputWeight * output
            : AiOptions.UnknownUsageUnits;

    /// <summary>Adds one call's usage to today's row, making it when it is the day's first.</summary>
    public async Task ChargeAsync(long units, CancellationToken cancellationToken)
    {
        var today = Today();
        await db.Database.ExecuteSqlAsync(
            $"""
            INSERT INTO "AiUsage" ("Day", "Units", "Calls") VALUES ({today}, {units}, 1)
            ON CONFLICT ("Day") DO UPDATE SET "Units" = "AiUsage"."Units" + EXCLUDED."Units", "Calls" = "AiUsage"."Calls" + 1
            """,
            cancellationToken);
    }

    /// <summary>How long until the day turns in UTC and the budget is full again.</summary>
    public TimeSpan UntilTomorrow()
    {
        var now = time.GetUtcNow();
        return new DateTimeOffset(now.UtcDateTime.Date.AddDays(1), TimeSpan.Zero) - now;
    }
}
