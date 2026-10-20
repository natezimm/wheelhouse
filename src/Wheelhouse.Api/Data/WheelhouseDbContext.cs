using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Chores;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Lists;
using Wheelhouse.Api.Meals;

namespace Wheelhouse.Api.Data;

public sealed partial class WheelhouseDbContext(DbContextOptions<WheelhouseDbContext> options, ICurrentFamily currentFamily)
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

    public DbSet<Chore> Chores => Set<Chore>();
    public DbSet<ChorePlan> ChorePlans => Set<ChorePlan>();
    public DbSet<ChoreCompletion> ChoreCompletions => Set<ChoreCompletion>();
    public DbSet<HouseholdList> HouseholdLists => Set<HouseholdList>();
    public DbSet<ListItem> ListItems => Set<ListItem>();
    public DbSet<GroceryCategory> GroceryCategories => Set<GroceryCategory>();
    public DbSet<MealSlot> MealSlots => Set<MealSlot>();
    public DbSet<MealCommand> MealCommands => Set<MealCommand>();
    public DbSet<Recipe> Recipes => Set<Recipe>();

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
            // Saving a tracked Family with an older value must never put the counter back.
            family.Property(f => f.CalendarChangeNumber).HasDefaultValue(0L)
                .Metadata.SetAfterSaveBehavior(PropertySaveBehavior.Ignore);
            family.Property(f => f.ChoresChangeNumber).HasDefaultValue(0L)
                .Metadata.SetAfterSaveBehavior(PropertySaveBehavior.Ignore);
            family.HasMany(f => f.Chores).WithOne().HasForeignKey(c => c.FamilyId).OnDelete(DeleteBehavior.Cascade);
            family.Property(f => f.ListsChangeNumber).HasDefaultValue(0L)
                .Metadata.SetAfterSaveBehavior(PropertySaveBehavior.Ignore);
            family.HasMany(f => f.Lists).WithOne().HasForeignKey(l => l.FamilyId).OnDelete(DeleteBehavior.Cascade);
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
            instance.Property(e => e.ETag).HasMaxLength(255);
            instance.Property(e => e.Title).HasMaxLength(1024);
            instance.Property(e => e.Location).HasMaxLength(1024);
            instance.HasIndex(e => new { e.CalendarSourceId, e.GoogleEventId }).IsUnique();
            // The calendar screens ask for a range of days.
            instance.HasIndex(e => new { e.FamilyId, e.StartsAt });
            instance.HasIndex(e => new { e.FamilyId, e.StartDate });
        });

        modelBuilder.Entity<Chore>(chore =>
        {
            chore.Property(c => c.Title).HasMaxLength(200);
            chore.Property(c => c.Notes).HasMaxLength(2000);
            chore.Property(c => c.Version).IsConcurrencyToken();
            chore.HasIndex(c => new { c.FamilyId, c.CreationId }).IsUnique();
            chore.HasIndex(c => new { c.FamilyId, c.DueDate });
            chore.HasOne<Member>().WithMany().HasForeignKey(c => c.MemberId).OnDelete(DeleteBehavior.SetNull);
            chore.HasMany(c => c.Plans).WithOne().HasForeignKey(p => p.ChoreId).OnDelete(DeleteBehavior.Cascade);
            chore.HasMany(c => c.Completions).WithOne().HasForeignKey(p => p.ChoreId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ChorePlan>(plan =>
        {
            plan.Property(p => p.Title).HasMaxLength(200);
            plan.Property(p => p.Notes).HasMaxLength(2000);
            plan.Property(p => p.Frequency).HasMaxLength(16);
            plan.HasIndex(p => new { p.ChoreId, p.EffectiveFrom }).IsUnique();
            plan.HasOne<Member>().WithMany().HasForeignKey(p => p.MemberId).OnDelete(DeleteBehavior.SetNull);
        });
        modelBuilder.Entity<ChoreCompletion>(completion =>
        {
            completion.HasKey(c => new { c.ChoreId, c.DueDate });
            completion.Property(c => c.Version).IsConcurrencyToken();
        });

        modelBuilder.Entity<HouseholdList>(list =>
        {
            list.Property(l => l.Name).HasMaxLength(100);
            list.Property(l => l.Version).IsConcurrencyToken();
            list.HasIndex(l => new { l.FamilyId, l.CreationId }).IsUnique();
            list.HasIndex(l => l.FamilyId).IsUnique().HasFilter("\"IsGrocery\"");
            list.HasMany(l => l.Items).WithOne().HasForeignKey(i => i.HouseholdListId).OnDelete(DeleteBehavior.Cascade);
            list.HasMany(l => l.Categories).WithOne().HasForeignKey(c => c.HouseholdListId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<ListItem>(item =>
        {
            item.Property(i => i.Text).HasMaxLength(200);
            item.Property(i => i.Notes).HasMaxLength(2000);
            item.Property(i => i.Quantity).HasMaxLength(50);
            item.Property(i => i.Unit).HasMaxLength(50);
            item.HasOne<GroceryCategory>().WithMany().HasForeignKey(i => i.CategoryId).OnDelete(DeleteBehavior.SetNull);
            item.Property(i => i.Version).IsConcurrencyToken();
            item.HasIndex(i => new { i.FamilyId, i.CreationId }).IsUnique();
            item.HasIndex(i => new { i.HouseholdListId, i.SortOrder });
            item.HasOne<Family>().WithMany().HasForeignKey(i => i.FamilyId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<GroceryCategory>(category =>
        {
            category.Property(c => c.Name).HasMaxLength(40);
            category.HasIndex(c => new { c.HouseholdListId, c.SortOrder });
            category.HasOne<Family>().WithMany().HasForeignKey(c => c.FamilyId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<MealSlot>(meal =>
        {
            meal.Property(m => m.Slot).HasMaxLength(16);
            meal.Property(m => m.Title).HasMaxLength(200);
            meal.Property(m => m.Notes).HasMaxLength(2000);
            meal.Property(m => m.Version).IsConcurrencyToken();
            meal.HasIndex(m => new { m.FamilyId, m.Date, m.Slot }).IsUnique();
            meal.HasOne<Family>().WithMany(f => f.Meals).HasForeignKey(m => m.FamilyId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<MealCommand>(command =>
        {
            command.HasKey(c => new { c.FamilyId, c.Id });
            command.HasOne<Family>().WithMany().HasForeignKey(c => c.FamilyId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Recipe>(recipe =>
        {
            recipe.HasKey(r => new { r.FamilyId, r.Id });
            recipe.Property(r => r.Version).IsConcurrencyToken();
            recipe.HasOne<Family>().WithMany(f => f.Recipes).HasForeignKey(r => r.FamilyId).OnDelete(DeleteBehavior.Cascade);
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

