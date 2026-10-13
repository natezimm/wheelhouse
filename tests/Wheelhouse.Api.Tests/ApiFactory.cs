using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Testcontainers.PostgreSql;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// Hosts the API against a throwaway PostgreSQL container. It starts as a private family
/// instance; <see cref="InMode"/> gives a host in another mode on the same database.
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    /// <summary>Reads responses the way the web app does: camelCase, enums as names.</summary>
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly PostgreSqlContainer _database = new PostgreSqlBuilder("postgres:17.11-bookworm").Build();

    public async Task InitializeAsync()
    {
        await _database.StartAsync();

        // Start the API once now. Its startup migrates the new database, so a test that writes
        // rows directly does not depend on another test having started a host first.
        CreateClient().Dispose();
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        await _database.DisposeAsync();
    }

    public Task StopDatabaseAsync() => _database.StopAsync();

    public WebApplicationFactory<Program> InMode(InstanceMode mode) =>
        WithWebHostBuilder(builder => builder.UseSetting("Wheelhouse:Mode", mode));

    /// <summary>A context that sees the database as <paramref name="familyId"/> would, or with no family at all.</summary>
    public WheelhouseDbContext DbContextFor(Guid? familyId) => new(
        new DbContextOptionsBuilder<WheelhouseDbContext>().UseNpgsql(_database.GetConnectionString()).Options,
        new FixedFamily(familyId));

    protected override void ConfigureWebHost(IWebHostBuilder builder) => builder
        .UseSetting("ConnectionStrings:Wheelhouse", _database.GetConnectionString())
        .UseSetting("Wheelhouse:Mode", InstanceMode.Family);

    private sealed record FixedFamily(Guid? Id) : ICurrentFamily;
}

public static class WebHostBuilderExtensions
{
    /// <summary>
    /// Overrides one setting, on top of every file the app loads. (The built-in UseSetting
    /// writes host configuration, which the app's own appsettings files take precedence over.)
    /// </summary>
    public static IWebHostBuilder UseSetting<T>(this IWebHostBuilder builder, string key, T value)
        where T : notnull =>
        builder.ConfigureAppConfiguration(configuration => configuration.AddInMemoryCollection(
            new Dictionary<string, string?> { [key] = value.ToString() }));
}

[CollectionDefinition(Name)]
public sealed class ApiCollection : ICollectionFixture<ApiFactory>
{
    public const string Name = "api";
}
