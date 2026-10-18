using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;
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

    /// <summary>A demo host on the same database, started once and shared.</summary>
    public WebApplicationFactory<Program> Demo => _demo ??= InMode(InstanceMode.Demo);

    private WebApplicationFactory<Program>? _demo;

    /// <summary>
    /// A new demo visitor: a client signed in to its own private copy of the demo family, as a
    /// parent. Tests that need to act as a parent use one, and get data no other test touches.
    /// </summary>
    public async Task<HttpClient> DemoVisitorAsync()
    {
        var client = Demo.CreateClient();
        (await client.PostAsync("/api/demo/visit", content: null)).EnsureSuccessStatusCode();
        return client;
    }

    /// <summary>
    /// A family instance with Google sign-in set up for <paramref name="parentEmails"/>, on a
    /// database of its own: a family instance holds one family, which the shared database,
    /// with every other test's families in it, cannot offer. Dispose it when done.
    /// </summary>
    public WebApplicationFactory<Program> NewFamilyInstance(string parentEmails)
    {
        var database = new NpgsqlConnectionStringBuilder(_database.GetConnectionString())
        {
            Database = $"family_{Guid.NewGuid():N}",
        };

        return WithWebHostBuilder(builder => builder
            .UseSetting("ConnectionStrings:Wheelhouse", database.ConnectionString)
            .UseSetting("Wheelhouse:ParentEmails", parentEmails)
            .UseSetting("Google:ClientId", GoogleClientId)
            .UseSetting("Google:ClientSecret", "test-secret"));
    }

    public const string GoogleClientId = "test-client.apps.googleusercontent.com";

    /// <summary>
    /// A client on a family <paramref name="instance"/> carrying the cookie the API issues at the
    /// end of a successful Google sign-in as <paramref name="google"/>.
    /// </summary>
    public static async Task<HttpClient> ParentAsync(WebApplicationFactory<Program> instance, GoogleIdentity google)
    {
        ClaimsPrincipal? principal;
        await using (var scope = instance.Services.CreateAsyncScope())
        {
            principal = await scope.ServiceProvider.GetRequiredService<ParentSignIn>().SignInAsync(google, timeZone: null, CancellationToken.None);
        }

        var cookie = instance.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(CookieAuthenticationDefaults.AuthenticationScheme);
        var ticket = new AuthenticationTicket(
            principal ?? throw new InvalidOperationException("Sign-in was refused."),
            new AuthenticationProperties { IsPersistent = true },
            CookieAuthenticationDefaults.AuthenticationScheme);

        var client = instance.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false, AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add("Cookie", $"wheelhouse={cookie.TicketDataFormat.Protect(ticket)}");
        return client;
    }

    /// <summary>A context that sees the database as <paramref name="familyId"/> would, or with no family at all.</summary>
    public WheelhouseDbContext DbContextFor(Guid? familyId) => new(
        new DbContextOptionsBuilder<WheelhouseDbContext>().UseNpgsql(_database.GetConnectionString()).Options,
        new FixedFamily(familyId));

    protected override void ConfigureWebHost(IWebHostBuilder builder) => builder
        .UseSetting("ConnectionStrings:Wheelhouse", _database.GetConnectionString())
        .UseSetting("Wheelhouse:Mode", InstanceMode.Family)
        // The sync tests run each sync themselves rather than wait on the worker.
        .UseSetting("CalendarSync:Enabled", false)
        // Live-update tests publish explicitly, except the test of the worker itself.
        .UseSetting("CalendarLive:Enabled", false)
        .UseSetting("HouseholdLive:Enabled", false);

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

