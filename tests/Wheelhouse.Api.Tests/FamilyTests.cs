using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class FamilyTests(ApiFactory factory)
{
    [Fact]
    public async Task A_demo_visitor_sees_the_demo_family_with_members_in_display_order()
    {
        using var visitor = await factory.DemoVisitorAsync();

        var family = await visitor.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json);

        Assert.NotNull(family);
        Assert.Equal("The Marlowe Family", family.Name);
        Assert.Equal(["Clara", "Julian", "Milo", "Nora"], family.Members.Select(member => member.DisplayName));
        Assert.Equal(new MemberResponse(family.Members[0].Id, "Clara", "#2563eb", "C", MemberRole.Parent), family.Members[0]);
        Assert.Equal(MemberRole.Kid, family.Members[2].Role);
    }

    [Fact]
    public async Task A_family_instance_answers_401_to_anyone_not_signed_in()
    {
        // A demo copy exists in the same database, so a 401 cannot be mistaken for "nothing to show".
        (await factory.DemoVisitorAsync()).Dispose();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/family");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_family_sees_only_its_own_rows()
    {
        var otherFamilyId = Guid.NewGuid();
        await using (var anyone = factory.DbContextFor(familyId: null))
        {
            var other = new Family { Id = otherFamilyId, Name = "The Others", TimeZone = "Europe/Paris" };
            other.Members.Add(new Member { Id = Guid.NewGuid(), FamilyId = otherFamilyId, DisplayName = "Zed", Color = "#7243B8", Initial = "Z" });
            anyone.Families.Add(other);
            await anyone.SaveChangesAsync();
        }

        using var visitor = await factory.DemoVisitorAsync();
        var mine = await visitor.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json);
        await using var asOther = factory.DbContextFor(otherFamilyId);
        await using var asMe = factory.DbContextFor(mine!.Id);
        await using var asNobody = factory.DbContextFor(familyId: null);

        Assert.DoesNotContain("Zed", mine.Members.Select(member => member.DisplayName));
        Assert.Equal(["Zed"], await asOther.Members.Select(member => member.DisplayName).ToListAsync());
        Assert.Equal(["The Others"], await asOther.Families.Select(family => family.Name).ToListAsync());
        Assert.Equal(["Clara", "Julian", "Milo", "Nora"], await asMe.Members.OrderBy(member => member.SortOrder).Select(member => member.DisplayName).ToListAsync());
        Assert.Empty(await asNobody.Members.ToListAsync());
        Assert.Empty(await asNobody.Families.ToListAsync());
    }
}
