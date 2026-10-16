using System.Net.Http.Json;
using System.Web;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

/// <summary>A family instance of its own, with Google replaced by <see cref="FakeGoogle"/> and a parent signed in.</summary>
internal sealed class GoogleFamily : IAsyncDisposable
{
    public required WebApplicationFactory<Program> Instance { get; init; }
    public required WebApplicationFactory<Program> WithFake { get; init; }
    public required FakeGoogle Google { get; init; }
    public required HttpClient Parent { get; init; }

    public static async Task<GoogleFamily> StartAsync(ApiFactory factory, GoogleIdentity parent, bool syncWorker = false)
    {
        var google = new FakeGoogle();
        var instance = factory.NewFamilyInstance(parent.Email);
        var withFake = instance.WithWebHostBuilder(builder => builder
            .UseSetting("CalendarSync:Enabled", syncWorker)
            .ConfigureTestServices(services => services.AddSingleton<IGoogleCalendar>(google)));
        return new GoogleFamily { Instance = instance, WithFake = withFake, Google = google, Parent = await ApiFactory.ParentAsync(withFake, parent) };
    }

    /// <summary>Goes to Google's consent screen and back, as the phone's browser would, with Google sending <paramref name="code"/>.</summary>
    public static async Task<HttpResponseMessage> ConnectAsync(HttpClient parent, string code = "first")
    {
        var toGoogle = await parent.GetAsync("/api/calendar/google/connect");
        var state = HttpUtility.ParseQueryString(toGoogle.Headers.Location!.Query)["state"]!;
        return await parent.GetAsync($"/api/calendar/google/callback?code={code}&state={Uri.EscapeDataString(state)}");
    }

    public async Task<FamilyResponse> FamilyAsync() =>
        (await Parent.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;

    /// <summary>Runs one sync of this family, as the worker would, at <paramref name="time"/>'s now.</summary>
    public async Task<bool> SyncAsync(TimeProvider? time = null)
    {
        var familyId = (await FamilyAsync()).Id;
        await using var scope = WithFake.Services.CreateAsyncScope();
        var sync = new CalendarSync(
            scope.ServiceProvider.GetRequiredService<WheelhouseDbContext>(),
            scope.ServiceProvider.GetRequiredService<GoogleTokens>(),
            Google,
            time ?? TimeProvider.System,
            NullLogger<CalendarSync>.Instance);
        return await sync.SyncFamilyAsync(familyId, CancellationToken.None);
    }

    public async ValueTask DisposeAsync()
    {
        Parent.Dispose();
        await WithFake.DisposeAsync();
        await Instance.DisposeAsync();
    }
}
