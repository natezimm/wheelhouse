using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Chores;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Lists;

namespace Wheelhouse.Api.Data;

public sealed partial class WheelhouseDbContext
{
    // Request handlers, the sync worker, demo seeds and conflict refreshes all pass this save
    // boundary. One save advances each affected family once, even for a whole series. A number
    // describes committed cache state, not an HTTP request or Google's sync bookkeeping.
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        var families = CalendarChanges();
        var chores = ChoreChanges();
        var lists = ListChanges();
        if (families.Count == 0 && chores.Count == 0 && lists.Count == 0)
        {
            return base.SaveChanges(acceptAllChangesOnSuccess);
        }

        using var transaction = Database.CurrentTransaction is null ? Database.BeginTransaction() : null;
        var outer = transaction is null ? Database.CurrentTransaction : null;
        const string savepoint = "CalendarChanges";
        outer?.CreateSavepoint(savepoint);
        try
        {
            var saved = base.SaveChanges(acceptAllChangesOnSuccess: false);
            foreach (var familyId in families)
            {
                Families.IgnoreQueryFilters().Where(f => f.Id == familyId)
                    .ExecuteUpdate(set => set.SetProperty(f => f.CalendarChangeNumber, f => f.CalendarChangeNumber + 1));
            }

            foreach (var familyId in chores)
            {
                Families.IgnoreQueryFilters().Where(f => f.Id == familyId)
                    .ExecuteUpdate(set => set.SetProperty(f => f.ChoresChangeNumber, f => f.ChoresChangeNumber + 1));
            }

            foreach (var familyId in lists)
            {
                Families.IgnoreQueryFilters().Where(f => f.Id == familyId)
                    .ExecuteUpdate(set => set.SetProperty(f => f.ListsChangeNumber, f => f.ListsChangeNumber + 1));
            }

            transaction?.Commit();
            outer?.ReleaseSavepoint(savepoint);
            if (acceptAllChangesOnSuccess)
            {
                ChangeTracker.AcceptAllChanges();
            }

            return saved;
        }
        catch
        {
            outer?.RollbackToSavepoint(savepoint);
            throw;
        }
    }

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        var families = CalendarChanges();
        var chores = ChoreChanges();
        var lists = ListChanges();
        if (families.Count == 0 && chores.Count == 0 && lists.Count == 0)
        {
            return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        }

        await using var transaction = Database.CurrentTransaction is null
            ? await Database.BeginTransactionAsync(cancellationToken) : null;
        var outer = transaction is null ? Database.CurrentTransaction : null;
        const string savepoint = "CalendarChanges";
        if (outer is not null)
        {
            await outer.CreateSavepointAsync(savepoint, cancellationToken);
        }

        try
        {
            var saved = await base.SaveChangesAsync(acceptAllChangesOnSuccess: false, cancellationToken);
            foreach (var familyId in families)
            {
                // A database-side increment serializes concurrent writers without a lost update.
                // Background sync has no current family, so opt out and name the family explicitly.
                await Families.IgnoreQueryFilters().Where(f => f.Id == familyId)
                    .ExecuteUpdateAsync(set => set.SetProperty(f => f.CalendarChangeNumber, f => f.CalendarChangeNumber + 1), cancellationToken);
            }

            foreach (var familyId in chores)
            {
                await Families.IgnoreQueryFilters().Where(f => f.Id == familyId)
                    .ExecuteUpdateAsync(set => set.SetProperty(f => f.ChoresChangeNumber, f => f.ChoresChangeNumber + 1), cancellationToken);
            }

            foreach (var familyId in lists)
            {
                await Families.IgnoreQueryFilters().Where(f => f.Id == familyId)
                    .ExecuteUpdateAsync(set => set.SetProperty(f => f.ListsChangeNumber, f => f.ListsChangeNumber + 1), cancellationToken);
            }

            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }

            if (outer is not null)
            {
                await outer.ReleaseSavepointAsync(savepoint, cancellationToken);
            }

            if (acceptAllChangesOnSuccess)
            {
                ChangeTracker.AcceptAllChanges();
            }

            return saved;
        }
        catch
        {
            if (outer is not null)
            {
                // A cancelled request still has to roll back the whole save, including the counter.
                await outer.RollbackToSavepointAsync(savepoint, CancellationToken.None);
            }

            throw;
        }
    }

    private List<Guid> CalendarChanges()
    {
        ChangeTracker.DetectChanges();
        var deleting = ChangeTracker.Entries<Family>()
            .Where(e => e.State == EntityState.Deleted).Select(e => e.Entity.Id).ToHashSet();

        return ChangeTracker.Entries()
            .Where(ChangesCalendar)
            .Select(e => e.Entity is Family family ? family.Id : ((IFamilyOwned)e.Entity).FamilyId)
            .Where(id => !deleting.Contains(id))
            .Distinct().Order().ToList();
    }

    private List<Guid> ListChanges()
    {
        var deleting = ChangeTracker.Entries<Family>().Where(e => e.State == EntityState.Deleted)
            .Select(e => e.Entity.Id).ToHashSet();
        return ChangeTracker.Entries().Where(e => e.Entity is HouseholdList or ListItem
            && e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .Select(e => ((IFamilyOwned)e.Entity).FamilyId).Where(id => !deleting.Contains(id)).Distinct().Order().ToList();
    }

    private List<Guid> ChoreChanges()
    {
        var deleting = ChangeTracker.Entries<Family>().Where(e => e.State == EntityState.Deleted)
            .Select(e => e.Entity.Id).ToHashSet();
        return ChangeTracker.Entries().Where(entry => entry.Entity switch
        {
            ChorePlan or ChoreCompletion => entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted,
            Chore => AddedOrDeleted(entry) || Changed(entry, nameof(Chore.Title), nameof(Chore.Notes),
                nameof(Chore.MemberId), nameof(Chore.DueDate), nameof(Chore.CompletedAt), nameof(Chore.Archived), nameof(Chore.ArchivedFrom)),
            Member => AddedOrDeleted(entry) || Changed(entry, nameof(Member.DisplayName), nameof(Member.Color)),
            Family => Changed(entry, nameof(Family.TimeZone)),
            _ => false,
        }).Select(e => e.Entity is Family f ? f.Id : ((IFamilyOwned)e.Entity).FamilyId)
            .Where(id => !deleting.Contains(id)).Distinct().Order().ToList();
    }

    private static bool ChangesCalendar(EntityEntry entry) => entry.Entity switch
    {
        EventInstance => AddedOrDeleted(entry) || Changed(entry,
            nameof(EventInstance.CalendarSourceId), nameof(EventInstance.Title), nameof(EventInstance.Location),
            nameof(EventInstance.StartsAt), nameof(EventInstance.EndsAt), nameof(EventInstance.StartDate),
            nameof(EventInstance.EndDate), nameof(EventInstance.RecurringEventId)),
        CalendarSource => AddedOrDeleted(entry) || Changed(entry,
            nameof(CalendarSource.Name), nameof(CalendarSource.MemberId), nameof(CalendarSource.CanWrite)),
        GoogleConnection => AddedOrDeleted(entry) || Changed(entry, nameof(GoogleConnection.Status)),
        Family => Changed(entry, nameof(Family.TimeZone)),
        // Deleting a member clears calendar ownership through ON DELETE SET NULL, even when
        // those CalendarSources are not loaded into this context.
        Member => entry.State == EntityState.Deleted,
        _ => false,
    };

    private static bool AddedOrDeleted(EntityEntry entry) => entry.State is EntityState.Added or EntityState.Deleted;

    private static bool Changed(EntityEntry entry, params string[] properties) =>
        entry.State == EntityState.Modified && properties.Any(name =>
        {
            var property = entry.Property(name);
            return property.IsModified && !Equals(property.OriginalValue, property.CurrentValue);
        });
}

