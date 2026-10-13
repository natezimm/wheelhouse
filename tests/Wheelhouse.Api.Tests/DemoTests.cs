using System.Net;
using System.Net.Http.Json;
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
        Assert.Equal(["Ben", "Tess", "Milo"], (await FamilyOf(second)).Members.Select(member => member.DisplayName));
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
        Assert.Equal(["Ben", "Tess", "Milo"], fresh.Members.Select(member => member.DisplayName));
    }

    [Fact]
    public async Task A_full_demo_turns_new_visitors_away_but_keeps_serving_those_it_has()
    {
        // Its own database, so the limit counts only this test's visitors.
        await using var own = new ApiFactory();
        await own.InitializeAsync();
        await using var demo = own.WithWebHostBuilder(builder => builder
            .UseSetting("Wheelhouse:Mode", InstanceMode.Demo)
            .UseSetting("Wheelhouse:MaxDemoCopies", 1));
        using var first = demo.CreateClient();
        using var second = demo.CreateClient();

        var admitted = await first.PostAsync("/api/demo/visit", content: null);
        var turnedAway = await second.PostAsync("/api/demo/visit", content: null);

        Assert.Equal(HttpStatusCode.NoContent, admitted.StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, turnedAway.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await second.GetAsync("/api/family")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await first.GetAsync("/api/family")).StatusCode);
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

        Assert.Equal(new SessionResponse(InstanceMode.Demo, SignedIn: false), await SessionOf(newcomer));
        Assert.Equal(new SessionResponse(InstanceMode.Demo, SignedIn: true), await SessionOf(visitor));
        Assert.Equal(new SessionResponse(InstanceMode.Family, SignedIn: false), await SessionOf(stranger));
    }

    private static Task<SessionResponse?> SessionOf(HttpClient client) =>
        client.GetFromJsonAsync<SessionResponse>("/api/session", ApiFactory.Json);
}
