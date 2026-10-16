using System.Net;
using System.Net.Http.Json;
using System.Web;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// Connecting the family's shared Google account and choosing its calendars. Each test runs a
/// family instance of its own with Google replaced by <see cref="FakeGoogle"/>.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class GoogleConnectionTests(ApiFactory factory)
{
    private static readonly GoogleIdentity Alex = new("google-alex", "alex@example.com", EmailVerified: true, "Alex", "Alex Rivera");

    private const string Full = $"openid email {GoogleConnectionEndpoints.CalendarScope}";

    private sealed class Family : IAsyncDisposable
    {
        public required WebApplicationFactory<Program> Instance { get; init; }
        public required WebApplicationFactory<Program> WithFake { get; init; }
        public required FakeGoogle Google { get; init; }
        public required HttpClient Parent { get; init; }

        public async ValueTask DisposeAsync()
        {
            Parent.Dispose();
            await WithFake.DisposeAsync();
            await Instance.DisposeAsync();
        }
    }

    private async Task<Family> FamilyAsync()
    {
        var google = new FakeGoogle();
        var instance = factory.NewFamilyInstance(Alex.Email);
        var withFake = instance.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddSingleton<IGoogleCalendar>(google)));
        return new Family { Instance = instance, WithFake = withFake, Google = google, Parent = await ApiFactory.ParentAsync(withFake, Alex) };
    }

    /// <summary>Goes to Google's consent screen and back, as the phone's browser would, with Google sending <paramref name="code"/>.</summary>
    private static async Task<HttpResponseMessage> ConnectAsync(HttpClient parent, string code = "first")
    {
        var toGoogle = await parent.GetAsync("/api/calendar/google/connect");
        var state = HttpUtility.ParseQueryString(toGoogle.Headers.Location!.Query)["state"]!;
        return await parent.GetAsync($"/api/calendar/google/callback?code={code}&state={Uri.EscapeDataString(state)}");
    }

    private static async Task<GoogleConnectionResponse> ConnectionOf(HttpClient parent) =>
        (await parent.GetFromJsonAsync<GoogleConnectionResponse>("/api/calendar/google", ApiFactory.Json))!;

    private static async Task<IReadOnlyList<CalendarChoice>> ChoicesOf(HttpClient parent) =>
        (await parent.GetFromJsonAsync<CalendarChoicesResponse>("/api/calendar/sources", ApiFactory.Json))!.Calendars;

    private static Task<HttpResponseMessage> ChooseAsync(HttpClient parent, params CalendarChoiceRequest[] calendars) =>
        parent.PutAsJsonAsync("/api/calendar/sources", new CalendarChoicesRequest(calendars), ApiFactory.Json);

    private static CalendarChoiceRequest Choice(string googleCalendarId, Guid? memberId) => new(googleCalendarId, memberId);

    [Fact]
    public async Task Connecting_asks_google_for_calendar_access_that_lasts_with_nobody_signed_in()
    {
        await using var family = await FamilyAsync();

        var response = await family.Parent.GetAsync("/api/calendar/google/connect");

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var google = response.Headers.Location!;
        Assert.Equal("https://accounts.google.com/o/oauth2/v2/auth", google.GetLeftPart(UriPartial.Path));
        var query = HttpUtility.ParseQueryString(google.Query);
        Assert.Equal(ApiFactory.GoogleClientId, query["client_id"]);
        Assert.Equal("http://localhost/api/calendar/google/callback", query["redirect_uri"]);
        Assert.Equal(Full, query["scope"]);
        Assert.Equal("offline", query["access_type"]);
        Assert.Contains("consent", query["prompt"]!.Split(' '));
        Assert.False(string.IsNullOrEmpty(query["state"]));
    }

    [Fact]
    public async Task Coming_back_from_google_keeps_the_refresh_token_encrypted_and_goes_on_to_choosing_calendars()
    {
        await using var family = await FamilyAsync();

        var response = await ConnectAsync(family.Parent, code: "first");

        Assert.Equal("/settings/calendars", response.Headers.Location!.ToString());
        Assert.Equal(("first", "http://localhost/api/calendar/google/callback"), Assert.Single(family.Google.Exchanged));
        Assert.Equal(new GoogleConnectionResponse(true, FakeGoogle.Account, GoogleConnectionStatus.Connected), await ConnectionOf(family.Parent));

        var familyId = (await family.Parent.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!.Id;
        await using (var db = family.WithFake.Services.CreateScope().ServiceProvider.GetRequiredService<Data.WheelhouseDbContext>())
        {
            var stored = await db.GoogleConnections.IgnoreQueryFilters().SingleAsync(c => c.FamilyId == familyId);
            Assert.DoesNotContain("refresh-first", stored.EncryptedRefreshToken);
        }

        // Reading the calendar list proves the token comes back out as it went in.
        await ChoicesOf(family.Parent);
        Assert.Equal("refresh-first", family.Google.LastRefreshToken);
    }

    [Fact]
    public async Task A_consent_that_was_not_started_for_this_family_connects_nothing()
    {
        await using var family = await FamilyAsync();
        var tokens = family.WithFake.Services.CreateScope().ServiceProvider.GetRequiredService<GoogleTokens>();
        var forAnotherFamily = Uri.EscapeDataString(tokens.ConsentState(Guid.NewGuid()));

        var madeUp = await family.Parent.GetAsync("/api/calendar/google/callback?code=x&state=made-up");
        var another = await family.Parent.GetAsync($"/api/calendar/google/callback?code=x&state={forAnotherFamily}");
        var cancelled = await family.Parent.GetAsync("/api/calendar/google/callback?error=access_denied");

        Assert.Equal("/settings?google=failed", madeUp.Headers.Location!.ToString());
        Assert.Equal("/settings?google=failed", another.Headers.Location!.ToString());
        Assert.Equal("/settings?google=cancelled", cancelled.Headers.Location!.ToString());
        Assert.Empty(family.Google.Exchanged);
        Assert.Null((await ConnectionOf(family.Parent)).Email);
    }

    [Fact]
    public async Task Unticking_calendar_access_on_googles_screen_connects_nothing()
    {
        await using var family = await FamilyAsync();
        family.Google.Scopes = "openid email";

        var response = await ConnectAsync(family.Parent);

        Assert.Equal("/settings?google=no-calendar", response.Headers.Location!.ToString());
        Assert.Null((await ConnectionOf(family.Parent)).Email);
    }

    [Fact]
    public async Task A_parent_chooses_which_calendars_show_and_whose_each_is()
    {
        await using var family = await FamilyAsync();
        await ConnectAsync(family.Parent);
        var alex = (await family.Parent.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!.Members.Single().Id;

        var before = await ChoicesOf(family.Parent);
        var saved = await ChooseAsync(family.Parent, Choice("alex-cal", alex), Choice("family-cal", null));
        var after = await ChoicesOf(family.Parent);
        var calendar = await family.Parent.GetFromJsonAsync<CalendarResponse>("/api/calendar?from=2026-10-12&to=2026-10-13", ApiFactory.Json);

        // The account's own calendar first, then by name.
        Assert.Equal(["Shared account", "Alex", "Family", "Holidays"], before.Select(c => c.Name));
        Assert.All(before, c => Assert.False(c.Shown));
        saved.EnsureSuccessStatusCode();
        Assert.Equal(
            [("alex-cal", true, (Guid?)alex), ("family-cal", true, null), ("holidays", false, null), ("primary", false, null)],
            after.Select(c => (c.GoogleCalendarId, c.Shown, c.MemberId)).Order());
        Assert.Equal([("Alex", (Guid?)alex), ("Family", null)], calendar!.Calendars.Select(c => (c.Name, c.MemberId)));
    }

    [Fact]
    public async Task Leaving_a_calendar_out_stops_showing_it()
    {
        await using var family = await FamilyAsync();
        await ConnectAsync(family.Parent);
        await ChooseAsync(family.Parent, Choice("alex-cal", null), Choice("family-cal", null));

        (await ChooseAsync(family.Parent, Choice("family-cal", null))).EnsureSuccessStatusCode();

        var calendar = await family.Parent.GetFromJsonAsync<CalendarResponse>("/api/calendar?from=2026-10-12&to=2026-10-13", ApiFactory.Json);
        Assert.Equal(["Family"], calendar!.Calendars.Select(c => c.Name));
    }

    [Fact]
    public async Task Only_the_accounts_own_calendars_and_the_familys_own_members_can_be_chosen()
    {
        await using var family = await FamilyAsync();
        await ConnectAsync(family.Parent);

        var unknown = await ChooseAsync(family.Parent, Choice("someone-elses-cal", null));
        var stranger = await ChooseAsync(family.Parent, Choice("alex-cal", Guid.NewGuid()));
        var twice = await ChooseAsync(family.Parent, Choice("alex-cal", null), Choice("alex-cal", null));

        foreach (var (response, field) in new[] { (unknown, "calendars"), (stranger, "memberId"), (twice, "calendars") })
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
            Assert.Contains(field, problem!.Errors.Keys);
        }
    }

    [Fact]
    public async Task When_google_stops_accepting_the_connection_a_parent_is_asked_to_connect_again()
    {
        await using var family = await FamilyAsync();
        await ConnectAsync(family.Parent);
        family.Google.Revoked = true;

        var refused = await family.Parent.GetAsync("/api/calendar/sources");
        var status = await ConnectionOf(family.Parent);
        family.Google.Revoked = false;
        await ConnectAsync(family.Parent, code: "second");

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal(GoogleConnectionStatus.NeedsReauth, status.Status);
        Assert.Equal(GoogleConnectionStatus.Connected, (await ConnectionOf(family.Parent)).Status);
        Assert.Equal(4, (await ChoicesOf(family.Parent)).Count);
        Assert.Equal("refresh-second", family.Google.LastRefreshToken);
    }

    [Fact]
    public async Task Connecting_a_different_account_forgets_the_old_ones_calendars()
    {
        await using var family = await FamilyAsync();
        await ConnectAsync(family.Parent);
        await ChooseAsync(family.Parent, Choice("alex-cal", null));
        family.Google.Email = "another.account@example.com";

        await ConnectAsync(family.Parent, code: "second");

        Assert.Equal("another.account@example.com", (await ConnectionOf(family.Parent)).Email);
        Assert.All(await ChoicesOf(family.Parent), c => Assert.False(c.Shown));
    }

    [Fact]
    public async Task Disconnecting_tells_google_and_removes_the_familys_calendars()
    {
        await using var family = await FamilyAsync();
        await ConnectAsync(family.Parent);
        await ChooseAsync(family.Parent, Choice("alex-cal", null));

        var response = await family.Parent.DeleteAsync("/api/calendar/google");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(["refresh-first"], family.Google.RevokedTokens);
        Assert.Null((await ConnectionOf(family.Parent)).Email);
        Assert.Empty(await ChoicesOf(family.Parent));
    }

    [Fact]
    public async Task The_demo_never_connects_google_but_a_visitor_can_say_whose_calendar_is_whose()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var members = (await visitor.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!.Members;
        var ben = members.Single(m => m.DisplayName == "Ben").Id;

        var connection = await ConnectionOf(visitor);
        var choices = await ChoicesOf(visitor);
        var keep = choices.Select(c => new CalendarChoiceRequest(c.GoogleCalendarId, c.Name == "Milo" ? ben : c.MemberId)).ToArray();
        var saved = await ChooseAsync(visitor, keep);

        Assert.Equal(new GoogleConnectionResponse(false, null, null), connection);
        Assert.Equal(HttpStatusCode.NotFound, (await visitor.GetAsync("/api/calendar/google/connect")).StatusCode);
        Assert.Equal(["Ben", "Family", "Milo", "Tess"], choices.Select(c => c.Name));
        Assert.All(choices, c => Assert.True(c.Shown));
        saved.EnsureSuccessStatusCode();
        Assert.Equal(ben, (await ChoicesOf(visitor)).Single(c => c.Name == "Milo").MemberId);
    }

    [Fact]
    public async Task Only_a_parent_manages_the_connection()
    {
        using var stranger = factory.Demo.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.GetAsync("/api/calendar/google")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.GetAsync("/api/calendar/sources")).StatusCode);
    }

    private sealed class FakeGoogle : IGoogleCalendar
    {
        public const string Account = "family.calendars@example.com";

        public string Email { get; set; } = Account;
        public string Scopes { get; set; } = Full;
        public bool Revoked { get; set; }
        public List<(string Code, string RedirectUri)> Exchanged { get; } = [];
        public List<string> RevokedTokens { get; } = [];
        public string? LastRefreshToken { get; private set; }

        public Task<GoogleGrant> ExchangeCodeAsync(string code, string redirectUri, CancellationToken cancellationToken)
        {
            Exchanged.Add((code, redirectUri));
            return Task.FromResult(new GoogleGrant($"refresh-{code}", Email, Scopes));
        }

        public Task<IReadOnlyList<GoogleCalendarEntry>> ListCalendarsAsync(string refreshToken, CancellationToken cancellationToken)
        {
            LastRefreshToken = refreshToken;
            if (Revoked)
            {
                throw new GoogleGrantRevokedException();
            }

            return Task.FromResult<IReadOnlyList<GoogleCalendarEntry>>(
            [
                new("holidays", "Holidays", "#16a765", CanWrite: false, Primary: false),
                new("family-cal", "Family", "#4986e7", CanWrite: true, Primary: false),
                new("primary", "Shared account", "#9fc6e7", CanWrite: true, Primary: true),
                new("alex-cal", "Alex", "#f83a22", CanWrite: true, Primary: false),
            ]);
        }

        public Task RevokeAsync(string refreshToken, CancellationToken cancellationToken)
        {
            RevokedTokens.Add(refreshToken);
            return Task.CompletedTask;
        }
    }
}
