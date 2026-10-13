using System.Net;
using System.Net.Http.Json;
using Wheelhouse.Api.Health;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class HealthTests(ApiFactory factory)
{
    [Fact]
    public async Task Health_is_200_and_healthy_when_the_database_is_reachable()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<HealthResponse>();
        Assert.NotNull(body);
        Assert.Equal("Healthy", body.Status);
        Assert.Equal("Healthy", body.Checks["database"]);
    }

    [Fact]
    public async Task Health_turns_503_and_names_the_database_when_it_goes_away()
    {
        // Its own database, because this test takes it down.
        await using var own = new ApiFactory();
        await own.InitializeAsync();
        using var client = own.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);

        await own.StopDatabaseAsync();
        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<HealthResponse>();
        Assert.NotNull(body);
        Assert.Equal("Unhealthy", body.Status);
        Assert.Equal("Unhealthy", body.Checks["database"]);
    }
}
