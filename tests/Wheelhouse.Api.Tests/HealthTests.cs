using System.Net;
using System.Net.Http.Json;
using Wheelhouse.Api.Health;

namespace Wheelhouse.Api.Tests;

public sealed class HealthTests(ApiFactory factory) : IClassFixture<ApiFactory>
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
    public async Task Health_is_503_and_names_the_database_when_it_is_unreachable()
    {
        // Port 1 on loopback refuses connections at once, so the check fails without waiting.
        const string nothingListening = "Host=127.0.0.1;Port=1;Database=wheelhouse;Username=wheelhouse;Password=unused;Timeout=2";
        await using var api = factory.WithWebHostBuilder(builder => builder.UseConnectionString(nothingListening));
        using var client = api.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<HealthResponse>();
        Assert.NotNull(body);
        Assert.Equal("Unhealthy", body.Status);
        Assert.Equal("Unhealthy", body.Checks["database"]);
    }
}
