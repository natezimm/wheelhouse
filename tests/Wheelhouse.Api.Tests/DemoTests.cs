using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Instance;
using Wheelhouse.Api.Sessions;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class DemoTests(ApiFactory factory)
{
    private static async Task<FamilyResponse> FamilyOf(HttpClient visitor) =>
        (await visitor.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;

    private static Task<HttpResponseMessage> Rename(HttpClient visitor, MemberResponse member, string name) =>
        visitor.PutAsJsonAsync($"/api/family/members/{member.Id}", new MemberRequest(name, member.Color, member.Role), ApiFactory.Json);

    [Fact]
    public async Task Each_visitor_gets_a_private_copy_that_no_other_visitor_can_see_or_change()
    {
        using var first = await factory.DemoVisitorAsync();
        using var second = await factory.DemoVisitorAsync();
        var firstFamily = await FamilyOf(first);
        var secondFamily = await FamilyOf(second);

        var ownChange = await Rename(first, firstFamily.Members[0], "Changed by the first visitor");
        var reachAcross = await Rename(first, secondFamily.Members[0], "Changed by the first visitor");

        Assert.NotEqual(firstFamily.Id, secondFamily.Id);
        Assert.Equal(HttpStatusCode.OK, ownChange.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, reachAcross.StatusCode);
        Assert.Equal("Changed by the first visitor", (await FamilyOf(first)).Members[0].DisplayName);
        Assert.Equal(["Clara", "Julian", "Milo", "Nora"], (await FamilyOf(second)).Members.Select(member => member.DisplayName));
    }

    [Fact]
    public async Task A_returning_visitor_keeps_their_copy_and_what_they_changed()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var before = await FamilyOf(visitor);
        await Rename(visitor, before.Members[0], "Still here");

        var again = await visitor.PostAsync("/api/demo/visit", content: null);

        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
        var after = await FamilyOf(visitor);
        Assert.Equal(before.Id, after.Id);
        Assert.Equal("Still here", after.Members[0].DisplayName);
    }

    [Fact]
    public async Task Cleanup_deletes_expired_copies_and_leaves_everything_else()
    {
        using var expired = await factory.DemoVisitorAsync();
        using var current = await factory.DemoVisitorAsync();
        var expiredId = (await FamilyOf(expired)).Id;
        var currentId = (await FamilyOf(current)).Id;
        var realFamilyId = Guid.NewGuid();
        await using (var anyone = factory.DbContextFor(familyId: null))
        {
            // A real family has no expiry, however old it is.
            anyone.Families.Add(new Family { Id = realFamilyId, Name = "A real family", TimeZone = "Europe/Paris" });
            await anyone.Families.IgnoreQueryFilters()
                .Where(family => family.Id == expiredId)
                .ExecuteUpdateAsync(set => set.SetProperty(family => family.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
            await anyone.SaveChangesAsync();
        }

        await using (var scope = factory.Demo.Services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<DemoCopies>().DeleteExpiredAsync(CancellationToken.None);
        }

        await using var db = factory.DbContextFor(familyId: null);
        var remaining = await db.Families.IgnoreQueryFilters().Select(family => family.Id).ToListAsync();
        Assert.DoesNotContain(expiredId, remaining);
        Assert.Contains(currentId, remaining);
        Assert.Contains(realFamilyId, remaining);
        Assert.Empty(await db.Members.IgnoreQueryFilters().Where(member => member.FamilyId == expiredId).ToListAsync());
    }

    [Fact]
    public async Task A_visitor_whose_copy_was_cleared_starts_again_from_a_fresh_one()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var old = await FamilyOf(visitor);
        await Rename(visitor, old.Members[0], "Gone with the old copy");
        await using (var anyone = factory.DbContextFor(familyId: null))
        {
            await anyone.Families.IgnoreQueryFilters().Where(family => family.Id == old.Id).ExecuteDeleteAsync();
        }

        var again = await visitor.PostAsync("/api/demo/visit", content: null);

        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
        var fresh = await FamilyOf(visitor);
        Assert.NotEqual(old.Id, fresh.Id);
        Assert.Equal(["Clara", "Julian", "Milo", "Nora"], fresh.Members.Select(member => member.DisplayName));
    }

    [Fact]
    public async Task A_full_demo_makes_room_for_a_new_visitor_by_deleting_the_oldest_copy()
    {
        // Its own database, so the limit counts only this test's visitors.
        await using var own = new ApiFactory();
        await own.InitializeAsync();
        await using var demo = own.WithWebHostBuilder(builder => builder
            .UseSetting("Wheelhouse:Mode", InstanceMode.Demo)
            .UseSetting("Wheelhouse:MaxDemoCopies", 2));
        using var first = demo.CreateClient();
        using var second = demo.CreateClient();
        using var third = demo.CreateClient();
        var realFamilyId = Guid.NewGuid();
        await using (var anyone = own.DbContextFor(familyId: null))
        {
            // A real family is never a copy, so it never makes room.
            anyone.Families.Add(new Family { Id = realFamilyId, Name = "A real family", TimeZone = "Europe/Paris" });
            await anyone.SaveChangesAsync();
        }

        Assert.Equal(HttpStatusCode.NoContent, (await first.PostAsync("/api/demo/visit", content: null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await second.PostAsync("/api/demo/visit", content: null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await third.PostAsync("/api/demo/visit", content: null)).StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await first.GetAsync("/api/family")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await second.GetAsync("/api/family")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await third.GetAsync("/api/family")).StatusCode);
        await using (var db = own.DbContextFor(familyId: null))
        {
            Assert.Equal(2, await db.Families.IgnoreQueryFilters().CountAsync(family => family.ExpiresAt != null));
            Assert.True(await db.Families.IgnoreQueryFilters().AnyAsync(family => family.Id == realFamilyId));
        }

        // The visitor whose copy made room gets a new one on their next visit.
        Assert.Equal(HttpStatusCode.NoContent, (await first.PostAsync("/api/demo/visit", content: null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await first.GetAsync("/api/family")).StatusCode);
    }

    [Fact]
    public async Task Newcomers_arriving_at_once_never_leave_more_copies_than_the_limit()
    {
        await using var own = new ApiFactory();
        await own.InitializeAsync();
        await using var demo = own.WithWebHostBuilder(builder => builder
            .UseSetting("Wheelhouse:Mode", InstanceMode.Demo)
            .UseSetting("Wheelhouse:MaxDemoCopies", 2));
        var visitors = Enumerable.Range(0, 6).Select(_ => demo.CreateClient()).ToList();

        var visits = await Task.WhenAll(visitors.Select(visitor => visitor.PostAsync("/api/demo/visit", content: null)));

        Assert.All(visits, visit => Assert.Equal(HttpStatusCode.NoContent, visit.StatusCode));
        await using var db = own.DbContextFor(familyId: null);
        Assert.Equal(2, await db.Families.IgnoreQueryFilters().CountAsync(family => family.ExpiresAt != null));
        visitors.ForEach(visitor => visitor.Dispose());
    }

    [Fact]
    public async Task One_address_cannot_fill_the_demo_with_new_copies()
    {
        Task<HttpContext> Visit(string address, string? cookie = null) => factory.Demo.Server.SendAsync(context =>
        {
            context.Request.Method = HttpMethods.Post;
            context.Request.Path = "/api/demo/visit";
            context.Connection.RemoteIpAddress = IPAddress.Parse(address);
            if (cookie is not null)
            {
                context.Request.Headers.Cookie = cookie;
            }
        });

        var admitted = new List<HttpContext>();
        for (var i = 0; i < 20; i++)
        {
            admitted.Add(await Visit("198.51.100.1"));
        }
        var turnedAway = await Visit("198.51.100.1");
        var cookie = admitted[0].Response.Headers.SetCookie.ToString().Split(';')[0];
        var returning = await Visit("198.51.100.1", cookie);
        var elsewhere = await Visit("198.51.100.2");

        Assert.All(admitted, visit => Assert.Equal(StatusCodes.Status204NoContent, visit.Response.StatusCode));
        Assert.Equal(StatusCodes.Status429TooManyRequests, turnedAway.Response.StatusCode);
        Assert.Equal(StatusCodes.Status204NoContent, returning.Response.StatusCode);
        Assert.Equal(0, returning.Response.Headers.SetCookie.Count);
        Assert.Equal(StatusCodes.Status204NoContent, elsewhere.Response.StatusCode);
    }

    [Fact]
    public async Task A_family_instance_has_no_way_in_through_the_demo()
    {
        using var stranger = factory.CreateClient();

        var visit = await stranger.PostAsync("/api/demo/visit", content: null);

        Assert.Equal(HttpStatusCode.NotFound, visit.StatusCode);
        Assert.False(visit.Headers.Contains("Set-Cookie"));
        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.GetAsync("/api/family")).StatusCode);
    }

    [Fact]
    public async Task The_session_reports_the_mode_and_whether_the_visitor_is_signed_in()
    {
        using var newcomer = factory.Demo.CreateClient();
        using var visitor = await factory.DemoVisitorAsync();
        using var stranger = factory.CreateClient();

        Assert.Equal(new SessionResponse(InstanceMode.Demo, SignedIn: false, CanSignIn: false), await SessionOf(newcomer));
        Assert.Equal(new SessionResponse(InstanceMode.Demo, SignedIn: true, CanSignIn: false), await SessionOf(visitor));
        Assert.Equal(new SessionResponse(InstanceMode.Family, SignedIn: false, CanSignIn: false), await SessionOf(stranger));
    }

    private static Task<SessionResponse?> SessionOf(HttpClient client) =>
        client.GetFromJsonAsync<SessionResponse>("/api/session", ApiFactory.Json);
}
