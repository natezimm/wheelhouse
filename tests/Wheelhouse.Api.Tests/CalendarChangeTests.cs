using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class CalendarChangeTests(ApiFactory factory)
{
    private static readonly DateOnly Day = new(2027, 1, 12);

    private static async Task<CalendarResponse> CalendarOf(HttpClient client, int days = 7) =>
        (await client.GetFromJsonAsync<CalendarResponse>(
            $"/api/calendar?from={Day:yyyy-MM-dd}&to={Day.AddDays(days):yyyy-MM-dd}", ApiFactory.Json))!;

    private static async Task<Guid> FamilyOf(HttpClient client) =>
        (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!.Id;

    private async Task<long> NumberOf(Guid familyId)
    {
        await using var db = factory.DbContextFor(familyId);
        return await db.Families.Select(f => f.CalendarChangeNumber).SingleAsync();
    }

    private static EventRequest Draft(Guid calendarId, string title, EventRepeat repeat = EventRepeat.Never) =>
        new(calendarId, title, null, true, Day, null, Day.AddDays(1), null, repeat);

    [Fact]
    public async Task A_seeded_calendar_has_one_durable_number_shared_by_all_date_ranges()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var familyId = await FamilyOf(visitor);
        var first = await CalendarOf(visitor);

        Assert.Equal(1, first.ChangeNumber);
        Assert.Equal(first.ChangeNumber, (await CalendarOf(visitor, days: 42)).ChangeNumber);
        // A fresh context, outside the HTTP request, sees the same persisted value.
        Assert.Equal(first.ChangeNumber, await NumberOf(familyId));
        await using var unscoped = factory.DbContextFor(null);
        Assert.Empty(await unscoped.Families.Select(f => f.CalendarChangeNumber).ToListAsync());
    }

    [Fact]
    public async Task Adding_changing_and_deleting_a_whole_series_each_advance_only_its_familys_number()
    {
        using var visitor = await factory.DemoVisitorAsync();
        using var other = await factory.DemoVisitorAsync();
        var before = await CalendarOf(visitor);
        var theirs = (await CalendarOf(other)).ChangeNumber;
        var request = Draft(before.Calendars[0].Id, "Revision test book club", EventRepeat.Weekly);
        var response = await visitor.PostAsJsonAsync("/api/calendar/events", request, ApiFactory.Json);
        response.EnsureSuccessStatusCode();
        var added = (await response.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!;
        Assert.Equal(before.ChangeNumber + 1, (await CalendarOf(visitor)).ChangeNumber);

        (await visitor.PutAsJsonAsync($"/api/calendar/events/{added.Id}?series=true",
            request with { Title = request.Title + " at the library" }, ApiFactory.Json)).EnsureSuccessStatusCode();
        Assert.Equal(before.ChangeNumber + 2, (await CalendarOf(visitor)).ChangeNumber);

        (await visitor.DeleteAsync($"/api/calendar/events/{added.Id}?series=true")).EnsureSuccessStatusCode();
        var after = await CalendarOf(visitor);
        Assert.Equal(before.ChangeNumber + 3, after.ChangeNumber);
        // Demo seeds also contain a Book club; only the series created by this test is removed.
        Assert.DoesNotContain(after.Events, e => e.Title.StartsWith(request.Title, StringComparison.Ordinal));
        Assert.All(before.Events, original => Assert.Contains(after.Events, e => e.Id == original.Id));
        Assert.Equal(theirs, (await CalendarOf(other)).ChangeNumber);

        var refused = await visitor.PostAsJsonAsync("/api/calendar/events", request with { Title = " " }, ApiFactory.Json);
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal(after.ChangeNumber, (await CalendarOf(visitor)).ChangeNumber);
    }

    [Fact]
    public async Task Source_changes_and_a_members_cascaded_ownership_change_advance_the_number()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var before = await CalendarOf(visitor);
        var family = (await visitor.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;
        var choices = (await visitor.GetFromJsonAsync<CalendarChoicesResponse>("/api/calendar/sources", ApiFactory.Json))!.Calendars;
        var child = family.Members.Single(m => m.DisplayName == "Milo");
        var requests = choices.Select(c => new CalendarChoiceRequest(c.GoogleCalendarId,
            c.Name == "Ben" ? child.Id : c.MemberId)).ToArray();
        (await visitor.PutAsJsonAsync("/api/calendar/sources", new CalendarChoicesRequest(requests), ApiFactory.Json)).EnsureSuccessStatusCode();
        Assert.Equal(before.ChangeNumber + 1, (await CalendarOf(visitor)).ChangeNumber);

        // Saving the same choices is not a new calendar snapshot.
        (await visitor.PutAsJsonAsync("/api/calendar/sources", new CalendarChoicesRequest(requests), ApiFactory.Json)).EnsureSuccessStatusCode();
        Assert.Equal(before.ChangeNumber + 1, (await CalendarOf(visitor)).ChangeNumber);

        (await visitor.DeleteAsync($"/api/family/members/{child.Id}")).EnsureSuccessStatusCode();
        var after = await CalendarOf(visitor);
        Assert.Equal(before.ChangeNumber + 2, after.ChangeNumber);
        Assert.All(after.Calendars.Where(c => c.Name is "Ben" or "Milo"), c => Assert.Null(c.MemberId));

        (await visitor.PutAsJsonAsync("/api/calendar/sources", new CalendarChoicesRequest([]), ApiFactory.Json)).EnsureSuccessStatusCode();
        var empty = await CalendarOf(visitor);
        Assert.Equal(after.ChangeNumber + 1, empty.ChangeNumber);
        Assert.Empty(empty.Calendars);
        Assert.Empty(empty.Events);
    }

    [Fact]
    public async Task Concurrent_writers_cannot_lose_an_increment_or_overwrite_it_with_a_tracked_family()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var familyId = await FamilyOf(visitor);
        var before = await CalendarOf(visitor);
        await using var stale = factory.DbContextFor(familyId);
        var family = await stale.Families.SingleAsync();

        var writes = Enumerable.Range(0, 8).Select(async i =>
        {
            await using var db = factory.DbContextFor(familyId);
            db.EventInstances.Add(new EventInstance
            {
                Id = Guid.NewGuid(), FamilyId = familyId, CalendarSourceId = before.Calendars[0].Id,
                GoogleEventId = $"concurrent-{i}", Title = $"Concurrent {i}", StartDate = Day, EndDate = Day.AddDays(1),
            });
            await db.SaveChangesAsync();
        });
        await Task.WhenAll(writes);

        family.Name = "Changed after concurrent writes";
        await stale.SaveChangesAsync();

        var after = await CalendarOf(visitor);
        Assert.Equal(before.ChangeNumber + 8, after.ChangeNumber);
        Assert.Equal(8, after.Events.Count(e => e.Title.StartsWith("Concurrent ")));
    }

    [Fact]
    public async Task A_background_save_advances_each_affected_family_once()
    {
        using var visitor = await factory.DemoVisitorAsync();
        using var other = await factory.DemoVisitorAsync();
        var ids = new[] { await FamilyOf(visitor), await FamilyOf(other) };
        var numbers = new[] { await NumberOf(ids[0]), await NumberOf(ids[1]) };
        await using var db = factory.DbContextFor(null);
        var sources = await db.CalendarSources.IgnoreQueryFilters().Where(s => ids.Contains(s.FamilyId)).ToListAsync();
        foreach (var source in sources)
        {
            source.CanWrite = false;
        }

        // Exercise the synchronous save overload as well as the async request/worker paths.
        db.SaveChanges();

        Assert.Equal(numbers[0] + 1, await NumberOf(ids[0]));
        Assert.Equal(numbers[1] + 1, await NumberOf(ids[1]));
    }

    [Fact]
    public async Task No_op_saves_and_google_bookkeeping_do_not_advance_the_number()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var familyId = await FamilyOf(visitor);
        var before = await CalendarOf(visitor);
        await using var db = factory.DbContextFor(familyId);
        var source = await db.CalendarSources.FirstAsync();
        var occurrence = await db.EventInstances.FirstAsync();
        source.LastSyncedAt = DateTimeOffset.UtcNow;
        source.ListedAt = DateTimeOffset.UtcNow;
        source.SyncToken = "new-token";
        occurrence.ETag = "new-etag";
        await db.SaveChangesAsync();
        await db.SaveChangesAsync();

        Assert.Equal(before.ChangeNumber, await NumberOf(familyId));
    }

    [Fact]
    public async Task Rolling_back_an_outer_transaction_rolls_back_events_and_the_number_together()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var familyId = await FamilyOf(visitor);
        var before = await CalendarOf(visitor);
        await using var db = factory.DbContextFor(familyId);
        await using var transaction = await db.Database.BeginTransactionAsync();
        var occurrence = await db.EventInstances.FirstAsync();
        var original = occurrence.Title;
        occurrence.Title = "Never committed";
        await db.SaveChangesAsync();

        Assert.Equal(before.ChangeNumber + 1, await db.Families.Select(f => f.CalendarChangeNumber).SingleAsync());
        // Other connections still see the old complete snapshot while the write is uncommitted.
        Assert.Equal(before.ChangeNumber, (await CalendarOf(visitor)).ChangeNumber);
        await transaction.RollbackAsync();

        await using var check = factory.DbContextFor(familyId);
        Assert.Equal(original, (await check.EventInstances.SingleAsync(e => e.Id == occurrence.Id)).Title);
        Assert.Equal(before.ChangeNumber, await NumberOf(familyId));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_failed_revision_increment_cannot_commit_the_calendar_change(bool outerTransaction)
    {
        using var visitor = await factory.DemoVisitorAsync();
        var familyId = await FamilyOf(visitor);
        await using var db = factory.DbContextFor(familyId);
        // Make the counter increment fail AFTER the event update has reached PostgreSQL.
        await db.Families.ExecuteUpdateAsync(set => set.SetProperty(f => f.CalendarChangeNumber, long.MaxValue));
        await using var outer = outerTransaction ? await db.Database.BeginTransactionAsync() : null;
        var occurrence = await db.EventInstances.FirstAsync();
        var original = occurrence.Title;
        occurrence.Title = "Must roll back";

        await Assert.ThrowsAsync<PostgresException>(() => db.SaveChangesAsync());
        if (outer is not null)
        {
            // A caller catching the failure must not be able to commit the event on its own.
            await outer.CommitAsync();
        }

        await using var check = factory.DbContextFor(familyId);
        Assert.Equal(original, (await check.EventInstances.SingleAsync(e => e.Id == occurrence.Id)).Title);
        Assert.Equal(long.MaxValue, await NumberOf(familyId));
    }

    [Fact]
    public async Task A_calendar_read_keeps_one_snapshot_when_a_write_commits_between_its_queries()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var familyId = await FamilyOf(visitor);
        var before = await CalendarOf(visitor);
        var source = before.Calendars[0];
        var interceptor = new AfterRevisionRead(async () =>
        {
            await using var writer = factory.DbContextFor(familyId);
            (await writer.CalendarSources.SingleAsync(c => c.Id == source.Id)).Name = "Changed during read";
            writer.EventInstances.Add(new EventInstance
            {
                Id = Guid.NewGuid(), FamilyId = familyId, CalendarSourceId = source.Id,
                GoogleEventId = "during-read", Title = "Added during read", StartDate = Day, EndDate = Day.AddDays(1),
            });
            writer.GoogleConnections.Add(new GoogleConnection
            {
                Id = Guid.NewGuid(), FamilyId = familyId, Email = "calendar@example.com", EncryptedRefreshToken = "test",
                Scopes = "", Status = GoogleConnectionStatus.NeedsReauth,
            });
            await writer.SaveChangesAsync();
        });
        await using var host = factory.Demo.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddDbContext<WheelhouseDbContext>(options => options.AddInterceptors(interceptor))));
        using var reader = host.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        // Sign the reader into the original demo copy, rather than creating a different family.
        var options = host.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(CookieAuthenticationDefaults.AuthenticationScheme);
        var ticket = new AuthenticationTicket(WheelhousePrincipal.Parent(familyId), new AuthenticationProperties(),
            CookieAuthenticationDefaults.AuthenticationScheme);
        reader.DefaultRequestHeaders.Add("Cookie", $"wheelhouse={options.TicketDataFormat.Protect(ticket)}");

        var during = await CalendarOf(reader);
        Assert.True(interceptor.Ran);
        Assert.Equal(before.ChangeNumber, during.ChangeNumber);
        Assert.Equal(source.Name, during.Calendars.Single(c => c.Id == source.Id).Name);
        Assert.DoesNotContain(during.Events, e => e.Title == "Added during read");
        Assert.False(during.NeedsReconnect);

        var after = await CalendarOf(visitor);
        Assert.Equal(before.ChangeNumber + 1, after.ChangeNumber);
        Assert.Equal("Changed during read", after.Calendars.Single(c => c.Id == source.Id).Name);
        Assert.Contains(after.Events, e => e.Title == "Added during read");
        Assert.True(after.NeedsReconnect);
    }

    private sealed class AfterRevisionRead(Func<Task> write) : DbCommandInterceptor
    {
        public bool Ran { get; private set; }

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
            DbDataReader result, CancellationToken cancellationToken = default)
        {
            if (!Ran && command.CommandText.Contains("CalendarChangeNumber", StringComparison.Ordinal))
            {
                Ran = true;
                await write();
            }

            return result;
        }
    }
}
