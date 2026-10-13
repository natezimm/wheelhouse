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
    [Fact]
    public async Task A_reset_puts_back_what_visitors_renamed_or_removed()
    {
        await using var demo = factory.InMode(InstanceMode.Demo);
        using var client = demo.CreateClient();
        await using (var db = factory.DbContextFor(DemoFamily.Id))
        {
            (await db.Members.SingleAsync(member => member.DisplayName == "Ben")).DisplayName = "Changed";
            db.Members.Remove(await db.Members.SingleAsync(member => member.DisplayName == "Milo"));
            await db.SaveChangesAsync();
        }

        await using (var scope = demo.Services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<DemoSeeder>().ResetAsync();
        }

        var family = await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json);
        Assert.Equal(["Ben", "Tess", "Milo"], family!.Members.Select(member => member.DisplayName));
    }

    [Fact]
    public async Task The_session_says_demo_visitors_are_signed_in_and_family_visitors_are_not()
    {
        using var demoClient = factory.InMode(InstanceMode.Demo).CreateClient();
        using var familyClient = factory.CreateClient();

        var demo = await demoClient.GetFromJsonAsync<SessionResponse>("/api/session", ApiFactory.Json);
        var family = await familyClient.GetFromJsonAsync<SessionResponse>("/api/session", ApiFactory.Json);

        Assert.Equal(new SessionResponse(InstanceMode.Demo, SignedIn: true), demo);
        Assert.Equal(new SessionResponse(InstanceMode.Family, SignedIn: false), family);
    }
}
