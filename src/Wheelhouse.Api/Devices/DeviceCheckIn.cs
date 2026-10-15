using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Devices;

/// <summary>
/// Runs on every request a display's cookie makes: it is still signed in only while its
/// device exists, and the request counts as the display being seen.
/// </summary>
public sealed class DeviceCheckIn(WheelhouseDbContext db, TimeProvider time)
{
    /// <summary>How stale <see cref="Device.LastSeenAt"/> may get before a request rewrites it.</summary>
    private static readonly TimeSpan SeenEvery = TimeSpan.FromMinutes(1);

    // The cookie is still being checked, so there is no current family yet: opt out of the filter.

    public async Task<bool> IsStillPairedAsync(Guid deviceId, CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var seen = await db.Devices
            .IgnoreQueryFilters()
            .Where(d => d.Id == deviceId && (d.LastSeenAt == null || d.LastSeenAt < now - SeenEvery))
            .ExecuteUpdateAsync(set => set.SetProperty(d => d.LastSeenAt, now), cancellationToken);

        return seen > 0 || await db.Devices.IgnoreQueryFilters().AnyAsync(d => d.Id == deviceId, cancellationToken);
    }
}
