using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Demo;

/// <summary>
/// The demo's visitor copies. Each visitor gets a private copy of the demo family, so nobody
/// sees what another visitor typed. A copy is a family row with an expiry.
/// </summary>
public sealed class DemoCopies(WheelhouseDbContext db, IOptions<InstanceOptions> instance, TimeProvider time, ILogger<DemoCopies> logger)
{
    /// <summary>How long a visitor keeps their copy, and their sign-in to it.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);

    // These run before anyone is signed in, or with no request at all, so there is no current
    // family: each query opts out of the family filter on purpose.

    public Task<bool> ExistsAsync(Guid familyId, CancellationToken cancellationToken) =>
        db.Families.IgnoreQueryFilters().AnyAsync(family => family.Id == familyId && family.ExpiresAt != null, cancellationToken);

    /// <summary>
    /// Makes a new copy and returns its family id. At the limit the oldest copies make room, so
    /// a newcomer is never turned away for copies their visitors may have long since left.
    /// </summary>
    public async Task<Guid> CreateAsync(CancellationToken cancellationToken)
    {
        var copies = db.Families.IgnoreQueryFilters().Where(family => family.ExpiresAt != null);
        var over = await copies.CountAsync(cancellationToken) - instance.Value.MaxDemoCopies + 1;
        if (over > 0)
        {
            var oldest = await copies.OrderBy(family => family.ExpiresAt).Select(family => family.Id).Take(over).ToListAsync(cancellationToken);
            await copies.Where(family => oldest.Contains(family.Id)).ExecuteDeleteAsync(cancellationToken);
            logger.LogWarning("The demo reached {Limit} copies; deleted the {Count} oldest", instance.Value.MaxDemoCopies, oldest.Count);
        }

        var family = DemoFamily.Create(Guid.NewGuid(), time.GetUtcNow() + Lifetime);
        db.Families.Add(family);
        await db.SaveChangesAsync(cancellationToken);

        return family.Id;
    }

    /// <summary>Deletes copies past their expiry, with everything they own. Returns how many.</summary>
    public Task<int> DeleteExpiredAsync(CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        return db.Families
            .IgnoreQueryFilters()
            .Where(family => family.ExpiresAt != null && family.ExpiresAt < now)
            .ExecuteDeleteAsync(cancellationToken);
    }
}
