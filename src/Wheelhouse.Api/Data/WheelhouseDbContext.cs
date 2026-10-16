using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Data;

public sealed class WheelhouseDbContext(DbContextOptions<WheelhouseDbContext> options, ICurrentFamily currentFamily)
    : DbContext(options)
{
    public DbSet<Family> Families => Set<Family>();

    public DbSet<Member> Members => Set<Member>();

    public DbSet<UserAccount> UserAccounts => Set<UserAccount>();

    public DbSet<Device> Devices => Set<Device>();

    public DbSet<PairingCode> PairingCodes => Set<PairingCode>();

    public DbSet<CalendarSource> CalendarSources => Set<CalendarSource>();

    public DbSet<EventInstance> EventInstances => Set<EventInstance>();

    public DbSet<GoogleConnection> GoogleConnections => Set<GoogleConnection>();

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

        modelBuilder.Entity<Device>(device =>
        {
            device.Property(d => d.Name).HasMaxLength(50);
            device.HasOne<Family>().WithMany(f => f.Devices).HasForeignKey(d => d.FamilyId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PairingCode>(pairing =>
        {
            pairing.Property(p => p.Code).HasMaxLength(6);
            pairing.HasIndex(p => p.Code).IsUnique();
            // Removing a display, or the demo copy it belongs to, takes its unused code with it.
            pairing.HasOne<Device>().WithMany().HasForeignKey(p => p.DeviceId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<CalendarSource>(source =>
        {
            source.Property(s => s.GoogleCalendarId).HasMaxLength(1024);
            source.Property(s => s.Name).HasMaxLength(255);
            source.Property(s => s.SyncToken).HasMaxLength(1024);
            source.HasIndex(s => new { s.FamilyId, s.GoogleCalendarId }).IsUnique();
            source.HasOne<Family>().WithMany(f => f.Calendars).HasForeignKey(s => s.FamilyId).OnDelete(DeleteBehavior.Cascade);
            // A calendar outlives the member it belonged to; a parent gives it to someone else.
            source.HasOne<Member>().WithMany().HasForeignKey(s => s.MemberId).OnDelete(DeleteBehavior.SetNull);
            source.HasMany(s => s.Events).WithOne().HasForeignKey(e => e.CalendarSourceId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<GoogleConnection>(connection =>
        {
            connection.Property(c => c.Email).HasMaxLength(320);
            connection.Property(c => c.Scopes).HasMaxLength(1024);
            connection.Property(c => c.Status).HasConversion<string>().HasMaxLength(16);
            // One shared account per family.
            connection.HasIndex(c => c.FamilyId).IsUnique();
            connection.HasOne<Family>().WithMany().HasForeignKey(c => c.FamilyId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<EventInstance>(instance =>
        {
            instance.Ignore(e => e.IsAllDay);
            instance.Property(e => e.GoogleEventId).HasMaxLength(1024);
            instance.Property(e => e.RecurringEventId).HasMaxLength(1024);
            instance.Property(e => e.Title).HasMaxLength(1024);
            instance.Property(e => e.Location).HasMaxLength(1024);
            instance.HasIndex(e => new { e.CalendarSourceId, e.GoogleEventId }).IsUnique();
            // The calendar screens ask for a range of days.
            instance.HasIndex(e => new { e.FamilyId, e.StartsAt });
            instance.HasIndex(e => new { e.FamilyId, e.StartDate });
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
