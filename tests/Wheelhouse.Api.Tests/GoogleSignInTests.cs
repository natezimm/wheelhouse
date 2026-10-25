using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Instance;
using Wheelhouse.Api.Sessions;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class GoogleSignInTests(ApiFactory factory)
{
    private const string Parents = "alex@example.com, Sam@Example.com";

    private static readonly GoogleIdentity Alex = new("google-alex", "alex@example.com", EmailVerified: true, "Alex", "Alex Rivera");

    private static readonly GoogleIdentity Sam = new("google-sam", "sam@example.com", EmailVerified: true, "Sam", "Sam Rivera");

    private static readonly WebApplicationFactoryClientOptions NoRedirects = new() { AllowAutoRedirect = false };

    /// <summary>What Google's round trip ends in: <see cref="ParentSignIn"/> deciding who this is.</summary>
    private static async Task<ClaimsPrincipal?> SignInAsync(WebApplicationFactory<Program> instance, GoogleIdentity google, string? timeZone = null)
    {
        await using var scope = instance.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<ParentSignIn>().SignInAsync(google, timeZone, CancellationToken.None);
    }

    private static Task<HttpClient> ParentAsync(WebApplicationFactory<Program> instance, GoogleIdentity google) =>
        ApiFactory.ParentAsync(instance, google);

    private static async Task<FamilyResponse> FamilyOf(HttpClient client) =>
        (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;

    [Fact]
    public async Task Sign_in_sends_the_parent_to_google_which_returns_them_to_the_api()
    {
        using var instance = factory.NewFamilyInstance(Parents);
        using var browser = instance.CreateClient(NoRedirects);

        var response = await browser.GetAsync("/api/auth/google?returnUrl=/settings");

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var google = response.Headers.Location!.ToString();
        Assert.StartsWith("https://accounts.google.com/o/oauth2/v2/auth?", google);
        Assert.Contains($"client_id={ApiFactory.GoogleClientId}", google);
        Assert.Contains("redirect_uri=http%3A%2F%2Flocalhost%2Fapi%2Fauth%2Fgoogle%2Fcallback", google);
        Assert.Contains("prompt=select_account", google);
    }

    [Fact]
    public async Task Coming_back_from_google_signs_a_listed_parent_in_and_turns_anyone_else_away()
    {
        using var instance = factory.NewFamilyInstance(Parents);

        var alex = await RoundTripAsync(instance, """{"sub":"google-alex","email":"alex@example.com","email_verified":true,"given_name":"Alex","name":"Alex Rivera"}""");
        var unverified = await RoundTripAsync(instance, """{"sub":"google-sam","email":"sam@example.com","email_verified":false,"given_name":"Sam"}""");
        var stranger = await RoundTripAsync(instance, """{"sub":"google-stranger","email":"stranger@example.com","email_verified":true}""");

        Assert.Equal("/settings", alex.Headers.Location!.ToString());
        var cookie = Assert.Single(alex.Headers.GetValues("Set-Cookie"), value => value.StartsWith("wheelhouse="));
        Assert.Contains("expires=", cookie);
        using var signedIn = instance.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        signedIn.DefaultRequestHeaders.Add("Cookie", cookie.Split(';')[0]);
        var family = await FamilyOf(signedIn);
        Assert.Equal("Alex", Assert.Single(family.Members).DisplayName);
        Assert.Equal("America/Chicago", family.TimeZone);

        foreach (var refused in new[] { unverified, stranger })
        {
            Assert.Equal("/?signin=refused", refused.Headers.Location!.ToString());
            Assert.DoesNotContain(refused.Headers.TryGetValues("Set-Cookie", out var set) ? set : [], value => value.StartsWith("wheelhouse="));
        }
    }

    /// <summary>
    /// Goes to Google and back as a browser would, with Google itself replaced by a stub that
    /// accepts any code and says the account is <paramref name="userInfo"/>.
    /// </summary>
    private static async Task<HttpResponseMessage> RoundTripAsync(WebApplicationFactory<Program> instance, string userInfo, string returnUrl = "/settings")
    {
        using var stubbed = instance.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.Configure<GoogleOptions>(GoogleDefaults.AuthenticationScheme, options =>
                options.BackchannelHttpHandler = new StubGoogle(userInfo))));
        using var browser = stubbed.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = false });

        var toGoogle = await browser.GetAsync($"/api/auth/google?returnUrl={Uri.EscapeDataString(returnUrl)}&timeZone=America/Chicago");
        var state = HttpUtility.ParseQueryString(toGoogle.Headers.Location!.Query)["state"];
        var correlation = toGoogle.Headers.GetValues("Set-Cookie").Select(value => value.Split(';')[0]);

        using var back = new HttpRequestMessage(HttpMethod.Get, $"/api/auth/google/callback?code=any&state={Uri.EscapeDataString(state!)}");
        back.Headers.Add("Cookie", string.Join("; ", correlation));
        return await browser.SendAsync(back);
    }

    [Theory]
    [InlineData("https://evil.example/")]
    [InlineData("//evil.example/")]
    [InlineData("/\\evil.example/")]
    // Browsers drop tabs and line breaks from a URL, which would turn these into //evil.example/.
    [InlineData("/\t/evil.example/")]
    [InlineData("/\n/evil.example/")]
    public async Task Sign_in_returns_only_to_a_page_on_this_site(string returnUrl)
    {
        using var instance = factory.NewFamilyInstance(Parents);

        var alex = await RoundTripAsync(instance, """{"sub":"google-alex","email":"alex@example.com","email_verified":true,"given_name":"Alex"}""", returnUrl);

        Assert.Equal("/", alex.Headers.Location!.ToString());
    }

    private sealed class StubGoogle(string userInfo) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.RequestUri!.Host == "oauth2.googleapis.com"
                ? """{"access_token":"stub","token_type":"Bearer","expires_in":3600}"""
                : userInfo;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            });
        }
    }

    [Fact]
    public async Task Only_a_family_instance_with_a_google_client_offers_sign_in()
    {
        using var demo = factory.Demo.CreateClient(NoRedirects);
        using var unconfigured = factory.CreateClient(NoRedirects);
        using var instance = factory.NewFamilyInstance(Parents);
        using var configured = instance.CreateClient(NoRedirects);

        Assert.Equal(HttpStatusCode.NotFound, (await demo.GetAsync("/api/auth/google")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await unconfigured.GetAsync("/api/auth/google")).StatusCode);
        Assert.False((await unconfigured.GetFromJsonAsync<SessionResponse>("/api/session", ApiFactory.Json))!.CanSignIn);
        Assert.Equal(
            new SessionResponse(InstanceMode.Family, SignedIn: false, CanSignIn: true),
            await configured.GetFromJsonAsync<SessionResponse>("/api/session", ApiFactory.Json));
    }

    [Fact]
    public async Task The_first_parent_to_sign_in_creates_the_family_in_their_time_zone()
    {
        using var instance = factory.NewFamilyInstance(Parents);

        Assert.NotNull(await SignInAsync(instance, Alex, timeZone: "America/Chicago"));
        using var alex = await ParentAsync(instance, Alex);
        var family = await FamilyOf(alex);

        Assert.Equal("America/Chicago", family.TimeZone);
        var member = Assert.Single(family.Members);
        Assert.Equal(("Alex", "A", MemberRole.Parent, "#2F5FC4"), (member.DisplayName, member.Initial, member.Role, member.Color));
        Assert.Equal(
            new SessionResponse(InstanceMode.Family, SignedIn: true, CanSignIn: true),
            await alex.GetFromJsonAsync<SessionResponse>("/api/session", ApiFactory.Json));
    }

    [Fact]
    public async Task Only_verified_addresses_on_the_parent_list_get_in()
    {
        using var instance = factory.NewFamilyInstance(Parents);

        var stranger = await SignInAsync(instance, new("google-stranger", "stranger@example.com", EmailVerified: true, "Stranger", null));
        var unverified = await SignInAsync(instance, Alex with { EmailVerified = false });
        var differentCase = await SignInAsync(instance, Sam with { Email = "SAM@example.com" });

        Assert.Null(stranger);
        Assert.Null(unverified);
        Assert.NotNull(differentCase);
    }

    [Fact]
    public async Task The_second_parent_becomes_the_member_already_added_for_them()
    {
        using var instance = factory.NewFamilyInstance(Parents);
        using var alex = await ParentAsync(instance, Alex);
        var added = await alex.PostAsJsonAsync("/api/family/members", new MemberRequest("Sam", "#137A6D", MemberRole.Parent), ApiFactory.Json);
        var samMember = (await added.Content.ReadFromJsonAsync<MemberResponse>(ApiFactory.Json))!;

        using var sam = await ParentAsync(instance, Sam);
        var family = await FamilyOf(sam);

        Assert.Equal((await FamilyOf(alex)).Id, family.Id);
        Assert.Equal(["Alex", "Sam"], family.Members.Select(member => member.DisplayName));
        Assert.Contains(family.Members, member => member.Id == samMember.Id);
    }

    [Fact]
    public async Task A_returning_parent_keeps_their_account()
    {
        using var instance = factory.NewFamilyInstance(Parents);

        var first = await SignInAsync(instance, Alex);
        var again = await SignInAsync(instance, Alex);
        using var alex = await ParentAsync(instance, Alex);

        Assert.Equal(first!.FindFirstValue(WheelhouseClaims.Account), again!.FindFirstValue(WheelhouseClaims.Account));
        Assert.Single((await FamilyOf(alex)).Members);
    }

    [Fact]
    public async Task Removing_a_parent_from_the_family_signs_them_out()
    {
        using var instance = factory.NewFamilyInstance(Parents);
        using var alex = await ParentAsync(instance, Alex);
        using var sam = await ParentAsync(instance, Sam);
        var samMember = (await FamilyOf(sam)).Members.Single(member => member.DisplayName == "Sam");

        (await alex.DeleteAsync($"/api/family/members/{samMember.Id}")).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.Unauthorized, (await sam.GetAsync("/api/family")).StatusCode);
    }

    [Fact]
    public async Task Taking_an_address_off_the_parent_list_signs_that_parent_out()
    {
        using var instance = factory.NewFamilyInstance(Parents);
        using var sam = await ParentAsync(instance, Sam);
        Assert.Equal(HttpStatusCode.OK, (await sam.GetAsync("/api/family")).StatusCode);

        // The same instance and database, restarted with Sam no longer on the list.
        using var restarted = instance.WithWebHostBuilder(builder => builder.UseSetting("Wheelhouse:ParentEmails", "alex@example.com"));
        using var samAfter = restarted.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        samAfter.DefaultRequestHeaders.Add("Cookie", sam.DefaultRequestHeaders.GetValues("Cookie"));

        Assert.Equal(HttpStatusCode.Unauthorized, (await samAfter.GetAsync("/api/family")).StatusCode);
        Assert.Null(await SignInAsync(restarted, Sam));
    }

    [Fact]
    public async Task Signing_out_clears_the_cookie()
    {
        using var instance = factory.NewFamilyInstance(Parents);
        using var alex = await ParentAsync(instance, Alex);

        var response = await alex.PostAsync("/api/auth/sign-out", content: null);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Contains(response.Headers.GetValues("Set-Cookie"), cookie => cookie.StartsWith("wheelhouse=;"));
    }
}
