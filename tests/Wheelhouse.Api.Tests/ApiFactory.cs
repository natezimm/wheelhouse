using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Testcontainers.PostgreSql;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// Hosts the API against a throwaway PostgreSQL container. Shared by a test class through
/// <see cref="IClassFixture{TFixture}"/>, so the container starts once per class.
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _database = new PostgreSqlBuilder("postgres:17.11-bookworm").Build();

    public Task InitializeAsync() => _database.StartAsync();

    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        await _database.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.UseConnectionString(_database.GetConnectionString());
}

public static class WebHostBuilderExtensions
{
    public static IWebHostBuilder UseConnectionString(this IWebHostBuilder builder, string connectionString) =>
        builder.ConfigureAppConfiguration(configuration => configuration.AddInMemoryCollection(
            new Dictionary<string, string?> { ["ConnectionStrings:Wheelhouse"] = connectionString }));
}
