using System.Net;
using System.Net.Http.Json;
using Wheelhouse.Api.Diagnostics;

namespace Wheelhouse.Api.Tests;

/// <summary>Screens reporting the errors they hit, so a wall's problems reach the API's log.</summary>
[Collection(ApiCollection.Name)]
public sealed class ClientErrorTests(ApiFactory factory)
{
    [Fact]
    public async Task A_signed_in_screen_can_report_an_error_and_a_stranger_cannot()
    {
        using var stranger = factory.Demo.CreateClient();
        using var visitor = await factory.DemoVisitorAsync();
        var report = new ClientErrorRequest("TypeError: x is undefined", new string('s', ClientErrorEndpoints.MaxStack * 2), "/wall", "wall");

        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.PostAsJsonAsync("/api/client-errors", report, ApiFactory.Json)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await visitor.PostAsJsonAsync("/api/client-errors", report, ApiFactory.Json)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await visitor.PostAsJsonAsync("/api/client-errors", new ClientErrorRequest(null, null, null, null), ApiFactory.Json)).StatusCode);
    }
}
