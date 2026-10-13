using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class FamilyTests(ApiFactory factory)
{
    [Fact]
    public async Task Demo_visitors_see_the_demo_family_with_members_in_display_order()
    {
        using var client = factory.InMode(InstanceMode.Demo).CreateClient();

        var family = await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json);

        Assert.NotNull(family);
        Assert.Equal("The Marlowes", family.Name);
        Assert.Equal(["Ben", "Tess", "Milo"], family.Members.Select(member => member.DisplayName));
        Assert.Equal(new MemberResponse(family.Members[0].Id, "Ben", "#2F5FC4", "B", MemberRole.Parent), family.Members[0]);
        Assert.Equal(MemberRole.Kid, family.Members[2].Role);
    }

    [Fact]
    public async Task A_family_instance_answers_401_to_anyone_not_signed_in()
    {
        // Seed the demo family first, so a 401 here cannot be mistaken for "nothing to show".
        factory.InMode(InstanceMode.Demo).CreateClient().Dispose();
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

        using var client = factory.InMode(InstanceMode.Demo).CreateClient();
        var demo = await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json);
        await using var asOther = factory.DbContextFor(otherFamilyId);
        await using var asDemo = factory.DbContextFor(DemoFamily.Id);
        await using var asNobody = factory.DbContextFor(familyId: null);

        Assert.DoesNotContain("Zed", demo!.Members.Select(member => member.DisplayName));
        Assert.Equal(["Zed"], await asOther.Members.Select(member => member.DisplayName).ToListAsync());
        Assert.Equal(["The Others"], await asOther.Families.Select(family => family.Name).ToListAsync());
        Assert.DoesNotContain("Zed", await asDemo.Members.Select(member => member.DisplayName).ToListAsync());
        Assert.Empty(await asNobody.Members.ToListAsync());
        Assert.Empty(await asNobody.Families.ToListAsync());
    }
}
