using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Data;

public sealed class WheelhouseDbContext(DbContextOptions<WheelhouseDbContext> options, ICurrentFamily currentFamily)
    : DbContext(options)
{
    public DbSet<Family> Families => Set<Family>();

    public DbSet<Member> Members => Set<Member>();

    public DbSet<UserAccount> UserAccounts => Set<UserAccount>();

    /// <summary>
    /// The family the query filters scope to. Null outside a signed-in request, and then
    /// filtered queries return nothing: code with no request, such as the demo seeder, has to
    /// opt out with <c>IgnoreQueryFilters()</c> on purpose.
    /// </summary>
    public Guid? CurrentFamilyId => currentFamily.Id;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Family>(family =>
        {
            family.HasQueryFilter(f => f.Id == CurrentFamilyId);
            family.Property(f => f.Name).HasMaxLength(100);
            family.Property(f => f.TimeZone).HasMaxLength(64);
            family.Property(f => f.WeekStartsOn).HasConversion<string>().HasMaxLength(16);
            family.Property(f => f.Units).HasConversion<string>().HasMaxLength(16);
            family.HasMany(f => f.Members).WithOne().HasForeignKey(m => m.FamilyId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Member>(member =>
        {
            member.Property(m => m.DisplayName).HasMaxLength(50);
            member.Property(m => m.Color).HasMaxLength(7);
            member.Property(m => m.Initial).HasMaxLength(2);
            member.Property(m => m.Role).HasConversion<string>().HasMaxLength(16);
            member.HasIndex(m => new { m.FamilyId, m.SortOrder });
        });

        modelBuilder.Entity<UserAccount>(account =>
        {
            account.Property(a => a.GoogleSubject).HasMaxLength(255);
            account.Property(a => a.Email).HasMaxLength(320);
            account.HasIndex(a => a.GoogleSubject).IsUnique();
            account.HasIndex(a => a.MemberId).IsUnique();
            account.HasOne(a => a.Member).WithOne().HasForeignKey<UserAccount>(a => a.MemberId).OnDelete(DeleteBehavior.Cascade);
            account.HasOne<Family>().WithMany().HasForeignKey(a => a.FamilyId).OnDelete(DeleteBehavior.Cascade);
        });

        // Every family-owned table gets the filter here, so a new one cannot be left unscoped.
        foreach (var entityType in modelBuilder.Model.GetEntityTypes().ToList())
        {
            if (typeof(IFamilyOwned).IsAssignableFrom(entityType.ClrType))
            {
                ScopeToCurrentFamilyMethod.MakeGenericMethod(entityType.ClrType).Invoke(this, [modelBuilder]);
            }
        }
    }

    private static readonly MethodInfo ScopeToCurrentFamilyMethod =
        typeof(WheelhouseDbContext).GetMethod(nameof(ScopeToCurrentFamily), BindingFlags.Instance | BindingFlags.NonPublic)!;

    private void ScopeToCurrentFamily<TEntity>(ModelBuilder modelBuilder)
        where TEntity : class, IFamilyOwned =>
        modelBuilder.Entity<TEntity>().HasQueryFilter(row => row.FamilyId == CurrentFamilyId);
}
