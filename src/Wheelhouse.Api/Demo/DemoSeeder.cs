using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Demo;

/// <summary>Puts the demo family back to its starting state.</summary>
public sealed class DemoSeeder(WheelhouseDbContext db)
{
    public async Task ResetAsync(CancellationToken cancellationToken = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // No request is in play here, so there is no current family: opt out of the filter.
        // Deleting the family takes everything it owns with it.
        await db.Families
            .IgnoreQueryFilters()
            .Where(family => family.Id == DemoFamily.Id)
            .ExecuteDeleteAsync(cancellationToken);

        db.ChangeTracker.Clear();
        db.Families.Add(DemoFamily.Create());
        await db.SaveChangesAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }
}
