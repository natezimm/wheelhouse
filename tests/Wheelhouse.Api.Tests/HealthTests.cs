using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Health;
using Wheelhouse.Api.Instance;

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
        Assert.True(response.Headers.CacheControl?.NoStore);
        var body = await response.Content.ReadFromJsonAsync<HealthResponse>();
        Assert.NotNull(body);
        Assert.Equal("Healthy", body.Status);
        Assert.Equal("Healthy", body.Checks["database"]);
        Assert.Equal("Healthy", body.Checks["calendar"]);
        Assert.Equal("Healthy", body.Checks["weather"]);
        Assert.NotNull(body.StartedAt);
        Assert.Equal(["calendar", "database", "weather"], body.Details!.Keys.Order());
    }

    [Fact]
    public async Task Health_names_the_release_and_how_far_behind_the_calendar_could_be()
    {
        using var client = factory.WithWebHostBuilder(builder => builder.UseSetting("Wheelhouse:Version", "v9.9.9")).CreateClient();

        var body = (await client.GetFromJsonAsync<HealthResponse>("/health"))!;

        Assert.Equal("v9.9.9", body.Version);
        var calendar = body.Details!["calendar"].Data!;
        // The tests turn the worker off, so nothing here says it is stuck.
        Assert.False(((JsonElement)calendar["syncsGoogle"]).GetBoolean());
        Assert.Equal(600, ((JsonElement)calendar["staleAfterSeconds"]).GetInt64());
        Assert.True(calendar.ContainsKey("needsReconnect"));
    }

    [Fact]
    public async Task Calendar_health_says_so_when_the_worker_stops_finishing_passes()
    {
        var time = new ManualTime(DateTimeOffset.UtcNow);
        var health = new CalendarSyncHealth(
            factory.Services.GetRequiredService<IServiceScopeFactory>(),
            time,
            Options.Create(new CalendarSyncOptions { Enabled = true }),
            Options.Create(new InstanceOptions { Mode = InstanceMode.Family }));

        time.Advance(TimeSpan.FromMinutes(11));
        var stuck = await health.CheckHealthAsync(new HealthCheckContext());
        Assert.Equal(HealthStatus.Degraded, stuck.Status);
        Assert.Contains("worker", stuck.Description);

        health.Passed();
        time.Advance(TimeSpan.FromSeconds(30));
        var passed = await health.CheckHealthAsync(new HealthCheckContext());
        // Other tests' families can leave the shared database degraded for their own reasons.
        Assert.DoesNotContain("worker", passed.Description ?? "");
        Assert.Equal(30L, passed.Data["lastPassAgeSeconds"]);
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
        // An exception's message can name the database's address; it stays in the log.
        Assert.DoesNotContain("5432", await response.Content.ReadAsStringAsync());
    }

    private sealed class ManualTime(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public void Advance(TimeSpan by) => _now += by;

        public override DateTimeOffset GetUtcNow() => _now;
    }
}
